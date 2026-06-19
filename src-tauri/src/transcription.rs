use crate::paths;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Default)]
pub struct TranscriptionState {
    running: Arc<Mutex<bool>>,
}

#[derive(Debug, Serialize)]
pub struct EngineStatus {
    engine_root: String,
    python: String,
    transcribe_path: String,
    default_output_dir: String,
    default_work_dir: String,
    can_run: bool,
    message: String,
}

#[derive(Debug, Deserialize)]
pub struct TranscriptionRequest {
    audio_path: String,
    output_dir: String,
    work_dir: Option<String>,
    model: String,
    asr_backend: String,
    language: String,
    audio_filter: String,
    batch_size: u32,
    threads: u32,
    device: String,
    compute_type: String,
    diarization: bool,
    speaker_mode: String,
    speakers: Option<u32>,
    min_speakers: Option<u32>,
    max_speakers: Option<u32>,
    trim_silence: bool,
    force: bool,
    speaker_map: Option<String>,
    hf_token: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct TranscriptionEvent {
    kind: String,
    stream: String,
    line: String,
    stage: String,
    progress: u8,
}

#[derive(Debug, Serialize)]
pub struct StartResponse {
    started: bool,
}

#[derive(Debug, Serialize)]
pub struct HistoryRecord {
    created_at: String,
    status: String,
    source_audio: String,
    stem: String,
    duration_seconds: Option<f64>,
    language: String,
    model: String,
    diarization: bool,
    outputs: Vec<String>,
}

#[tauri::command]
pub fn engine_status() -> EngineStatus {
    build_engine_status()
}

#[tauri::command]
pub fn expected_outputs(audio_path: String, output_dir: String) -> Result<Vec<paths::OutputFile>, String> {
    if audio_path.trim().is_empty() || output_dir.trim().is_empty() {
        return Ok(Vec::new());
    }
    Ok(paths::expected_output_paths(
        Path::new(audio_path.trim()),
        Path::new(output_dir.trim()),
    ))
}

#[tauri::command]
pub fn read_history(output_dir: String) -> Result<Vec<HistoryRecord>, String> {
    let history_path = Path::new(output_dir.trim()).join("transcription-history.jsonl");
    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(history_path).map_err(|error| error.to_string())?;
    let mut records = Vec::new();
    for line in content.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        records.push(HistoryRecord {
            created_at: value
                .get("created_at")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            status: value.get("status").and_then(Value::as_str).unwrap_or_default().to_string(),
            source_audio: value
                .get("source_audio")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            stem: value.get("stem").and_then(Value::as_str).unwrap_or_default().to_string(),
            duration_seconds: value.get("duration_seconds").and_then(Value::as_f64),
            language: value.get("language").and_then(Value::as_str).unwrap_or_default().to_string(),
            model: value.get("model").and_then(Value::as_str).unwrap_or_default().to_string(),
            diarization: value.get("diarization").and_then(Value::as_bool).unwrap_or(false),
            outputs: value
                .get("outputs")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(ToString::to_string)
                        .collect()
                })
                .unwrap_or_default(),
        });
    }
    records.reverse();
    records.truncate(20);
    Ok(records)
}

#[tauri::command]
pub fn read_text_preview(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Ok(String::new());
    }
    let mut content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    if content.len() > 20_000 {
        content.truncate(20_000);
    }
    Ok(content)
}

#[tauri::command]
pub fn start_transcription(
    app: AppHandle,
    state: State<TranscriptionState>,
    request: TranscriptionRequest,
) -> Result<StartResponse, String> {
    {
        let mut running = state.running.lock().map_err(|_| "Etat process indisponible.".to_string())?;
        if *running {
            return Err("Une transcription est déjà en cours.".to_string());
        }
        *running = true;
    }

    let status = build_engine_status();
    if !status.can_run {
        set_running(&state, false)?;
        return Err(status.message);
    }

    let state_for_thread = state.inner().clone();
    thread::spawn(move || {
        if let Err(error) = run_transcription(app.clone(), request, status) {
            let _ = emit_event(
                &app,
                "failed",
                "system",
                &error,
                "Echec",
                0,
            );
        }
        let _ = set_running_direct(&state_for_thread, false);
    });

    Ok(StartResponse { started: true })
}

fn run_transcription(app: AppHandle, request: TranscriptionRequest, status: EngineStatus) -> Result<(), String> {
    let audio = PathBuf::from(request.audio_path.trim());
    if !audio.exists() {
        return Err(format!("Fichier audio introuvable: {}", audio.to_string_lossy()));
    }

    let output_dir = PathBuf::from(request.output_dir.trim());
    let work_dir = request
        .work_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(status.default_work_dir.clone()));
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&work_dir).map_err(|error| error.to_string())?;

    let mut args = vec![
        "-u".to_string(),
        status.transcribe_path.clone(),
        "--audio".to_string(),
        audio.to_string_lossy().to_string(),
        "--output-dir".to_string(),
        output_dir.to_string_lossy().to_string(),
        "--work-dir".to_string(),
        work_dir.to_string_lossy().to_string(),
        "--model".to_string(),
        request.model,
        "--asr-backend".to_string(),
        request.asr_backend,
        "--language".to_string(),
        request.language,
        "--audio-filter".to_string(),
        request.audio_filter,
        "--batch-size".to_string(),
        request.batch_size.to_string(),
        "--threads".to_string(),
        request.threads.to_string(),
        "--device".to_string(),
        request.device,
        "--compute-type".to_string(),
        request.compute_type,
    ];

    if request.trim_silence {
        args.push("--trim-silence".to_string());
    }
    if request.force {
        args.push("--force".to_string());
    }
    if let Some(speaker_map) = request.speaker_map.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        args.extend(["--speaker-map".to_string(), speaker_map.to_string()]);
    }
    if request.diarization {
        match request.speaker_mode.as_str() {
            "exact" => {
                if let Some(speakers) = request.speakers {
                    args.extend(["--speakers".to_string(), speakers.to_string()]);
                }
            }
            "range" => {
                if let Some(min_speakers) = request.min_speakers {
                    args.extend(["--min-speakers".to_string(), min_speakers.to_string()]);
                }
                if let Some(max_speakers) = request.max_speakers {
                    args.extend(["--max-speakers".to_string(), max_speakers.to_string()]);
                }
            }
            _ => {}
        }
    } else {
        args.push("--no-diarization".to_string());
    }

    let command_preview = format!("{} {}", status.python, args.join(" "));
    emit_event(&app, "started", "system", &command_preview, "Préparation", 5)?;

    let mut command = Command::new(&status.python);
    command
        .args(&args)
        .current_dir(&status.engine_root)
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(token) = request.hf_token.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        command.env("HUGGINGFACE_TOKEN", token);
    }

    let mut child = command.spawn().map_err(|error| format!("Impossible de lancer le moteur Python: {error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_handle = stdout.map(|stream| spawn_reader(app.clone(), "stdout", stream));
    let stderr_handle = stderr.map(|stream| spawn_reader(app.clone(), "stderr", stream));

    let status = child.wait().map_err(|error| error.to_string())?;
    if let Some(handle) = stdout_handle {
        let _ = handle.join();
    }
    if let Some(handle) = stderr_handle {
        let _ = handle.join();
    }

    if status.success() {
        emit_event(&app, "completed", "system", "Process terminé.", "Terminé", 100)?;
        Ok(())
    } else {
        Err(format!(
            "Process terminé avec code {}.",
            status.code().map_or_else(|| "inconnu".to_string(), |code| code.to_string())
        ))
    }
}

fn spawn_reader<R>(app: AppHandle, stream_name: &'static str, stream: R) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            let (stage, progress) = stage_from_line(&line);
            let _ = emit_event(&app, "log", stream_name, &line, &stage, progress);
        }
    })
}

fn stage_from_line(line: &str) -> (String, u8) {
    let mappings = [
        ("Preparing clean", "Préparation audio", 10),
        ("Using existing preprocessed WAV", "Audio préparé", 15),
        ("Loading ASR model", "Chargement modèle", 25),
        ("Transcribing", "Transcription", 35),
        ("Saved asr checkpoint", "Transcription terminée", 64),
        ("Aligning timestamps", "Alignement temporel", 65),
        ("Saved aligned checkpoint", "Alignement terminé", 80),
        ("Running speaker diarization", "Séparation des locuteurs", 82),
        ("Diarization skipped", "Séparation ignorée", 82),
        ("Done. Files written", "Ecriture des résultats", 95),
        ("History updated", "Historique mis à jour", 98),
    ];

    for (needle, stage, progress) in mappings {
        if line.contains(needle) {
            return (stage.to_string(), progress);
        }
    }
    ("En cours".to_string(), 0)
}

fn emit_event(
    app: &AppHandle,
    kind: &str,
    stream: &str,
    line: &str,
    stage: &str,
    progress: u8,
) -> Result<(), String> {
    app.emit(
        "transcription-event",
        TranscriptionEvent {
            kind: kind.to_string(),
            stream: stream.to_string(),
            line: line.to_string(),
            stage: stage.to_string(),
            progress,
        },
    )
    .map_err(|error| error.to_string())
}

fn build_engine_status() -> EngineStatus {
    let engine_root = find_engine_root().unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let transcribe_path = engine_root.join("transcribe.py");
    let python = find_python(&engine_root);
    let data_root = default_data_root(&engine_root);
    let default_output_dir = paths::default_output_dir(&data_root);
    let default_work_dir = paths::default_work_dir(&data_root);
    let python_exists = Path::new(&python).exists() || python == "python3" || python == "python";
    let can_run = transcribe_path.exists() && python_exists;
    let message = if can_run {
        "Moteur Python détecté.".to_string()
    } else if !transcribe_path.exists() {
        format!("transcribe.py introuvable depuis {}", engine_root.to_string_lossy())
    } else {
        "Python introuvable. Configure MICROWEST_PYTHON ou crée .venv.".to_string()
    };

    EngineStatus {
        engine_root: engine_root.to_string_lossy().to_string(),
        python,
        transcribe_path: transcribe_path.to_string_lossy().to_string(),
        default_output_dir: default_output_dir.to_string_lossy().to_string(),
        default_work_dir: default_work_dir.to_string_lossy().to_string(),
        can_run,
        message,
    }
}

fn find_engine_root() -> Option<PathBuf> {
    if let Ok(path) = env::var("MICROWEST_ENGINE_ROOT") {
        let path = PathBuf::from(path);
        if let Some(engine_root) = resolve_engine_root(&path) {
            return Some(engine_root);
        }
    }

    let mut candidates = Vec::new();
    if let Ok(current) = env::current_dir() {
        candidates.push(current.clone());
        if let Some(parent) = current.parent() {
            candidates.push(parent.to_path_buf());
            if let Some(grand_parent) = parent.parent() {
                candidates.push(grand_parent.to_path_buf());
            }
        }
    }

    let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_root.clone());
    if let Some(parent) = manifest_root.parent() {
        candidates.push(parent.to_path_buf());
        if let Some(grand_parent) = parent.parent() {
            candidates.push(grand_parent.to_path_buf());
        }
    }

    candidates.into_iter().find_map(|candidate| resolve_engine_root(&candidate))
}

fn find_python(engine_root: &Path) -> String {
    if let Ok(path) = env::var("MICROWEST_PYTHON") {
        return path;
    }

    for root in [default_data_root(engine_root), engine_root.to_path_buf()] {
        let venv_python = if cfg!(target_os = "windows") {
            root.join(".venv").join("Scripts").join("python.exe")
        } else {
            root.join(".venv").join("bin").join("python")
        };
        if venv_python.exists() {
            return venv_python.to_string_lossy().to_string();
        }
    }

    if cfg!(target_os = "windows") {
        "python".to_string()
    } else {
        "python3".to_string()
    }
}

fn resolve_engine_root(candidate: &Path) -> Option<PathBuf> {
    if candidate.join("transcribe.py").exists() {
        return Some(candidate.to_path_buf());
    }

    let nested = candidate.join("engine").join("python");
    if nested.join("transcribe.py").exists() {
        return Some(nested);
    }

    None
}

fn default_data_root(engine_root: &Path) -> PathBuf {
    if engine_root.file_name().and_then(|value| value.to_str()) == Some("python") {
        if let Some(engine_dir) = engine_root.parent() {
            if engine_dir.file_name().and_then(|value| value.to_str()) == Some("engine") {
                if let Some(repo_root) = engine_dir.parent() {
                    return repo_root.to_path_buf();
                }
            }
        }
    }
    engine_root.to_path_buf()
}

fn set_running(state: &State<TranscriptionState>, value: bool) -> Result<(), String> {
    set_running_direct(state.inner(), value)
}

fn set_running_direct(state: &TranscriptionState, value: bool) -> Result<(), String> {
    let mut running = state.running.lock().map_err(|_| "Etat process indisponible.".to_string())?;
    *running = value;
    Ok(())
}
