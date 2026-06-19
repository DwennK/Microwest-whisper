use crate::{license, model_assets, paths};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const BACKEND_NAME: &str = "whisper.cpp";
const DEFAULT_COMMAND_TIMEOUT_SECONDS: u64 = 8 * 60 * 60;

#[derive(Clone, Default)]
pub struct TranscriptionState {
    running: Arc<Mutex<bool>>,
    cancel_requested: Arc<AtomicBool>,
    active_child: Arc<Mutex<Option<Child>>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct EngineStatus {
    backend: String,
    engine_root: String,
    whisper_cli: String,
    ffmpeg: String,
    model_path: String,
    default_model: String,
    default_output_dir: String,
    default_work_dir: String,
    platform: String,
    architecture: String,
    can_run: bool,
    message: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct TranscriptionRequest {
    audio_path: String,
    output_dir: String,
    work_dir: Option<String>,
    model: String,
    language: String,
    audio_filter: String,
    threads: u32,
    device: String,
    trim_silence: bool,
    force: bool,
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
pub struct CancelResponse {
    cancelled: bool,
}

#[derive(Debug, Serialize)]
pub struct AppDiagnostics {
    name: String,
    version: String,
    backend: String,
    platform: String,
    architecture: String,
    engine_root: String,
    default_output_dir: String,
    default_work_dir: String,
    model_dir: String,
    license_state_path: String,
    update_endpoint: String,
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

#[derive(Debug)]
struct TranscriptionPaths {
    audio: PathBuf,
    output_dir: PathBuf,
    work_dir: PathBuf,
    wav: PathBuf,
}

#[derive(Debug, Serialize, Clone)]
struct TranscriptSegment {
    start: f64,
    end: f64,
    text: String,
}

#[derive(Debug, Serialize, Clone)]
struct NativeTranscript {
    backend: String,
    model: String,
    model_path: String,
    language: String,
    source_audio: String,
    preprocessed_wav: String,
    duration_seconds: Option<f64>,
    text: String,
    segments: Vec<TranscriptSegment>,
}

#[tauri::command]
pub fn engine_status(app: AppHandle) -> EngineStatus {
    build_engine_status(Some(&app))
}

#[tauri::command]
pub fn model_status(app: AppHandle) -> model_assets::ModelInventory {
    let engine_root = find_engine_root(Some(&app));
    model_assets::model_status(&engine_root)
}

#[tauri::command]
pub fn app_diagnostics(app: AppHandle) -> AppDiagnostics {
    let status = build_engine_status(Some(&app));
    AppDiagnostics {
        name: "Microwest Whisper".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        backend: BACKEND_NAME.to_string(),
        platform: env::consts::OS.to_string(),
        architecture: env::consts::ARCH.to_string(),
        engine_root: status.engine_root,
        default_output_dir: status.default_output_dir,
        default_work_dir: status.default_work_dir,
        model_dir: model_assets::models_dir_path()
            .to_string_lossy()
            .to_string(),
        license_state_path: license::license_state_path().to_string_lossy().to_string(),
        update_endpoint:
            "https://github.com/DwennK/Microwest-whisper/releases/latest/download/latest.json"
                .to_string(),
    }
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model: String,
) -> Result<model_assets::ModelInventory, String> {
    let engine_root = find_engine_root(Some(&app));
    model_assets::download_model(&app, &engine_root, &model).await
}

#[tauri::command]
pub fn delete_downloaded_models(app: AppHandle) -> Result<model_assets::ModelInventory, String> {
    let engine_root = find_engine_root(Some(&app));
    model_assets::delete_downloaded_models(&engine_root)
}

#[tauri::command]
pub fn expected_outputs(
    audio_path: String,
    output_dir: String,
) -> Result<Vec<paths::OutputFile>, String> {
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
            status: value
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            source_audio: value
                .get("source_audio")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            stem: value
                .get("stem")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            duration_seconds: value.get("duration_seconds").and_then(Value::as_f64),
            language: value
                .get("language")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            model: value
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            diarization: value
                .get("diarization")
                .and_then(Value::as_bool)
                .unwrap_or(false),
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
        let mut running = state
            .running
            .lock()
            .map_err(|_| "Etat process indisponible.".to_string())?;
        if *running {
            return Err("Une transcription est déjà en cours.".to_string());
        }
        *running = true;
    }
    state.cancel_requested.store(false, Ordering::SeqCst);

    let status = build_engine_status(Some(&app));
    if !status.can_run {
        set_running(&state, false)?;
        return Err(status.message);
    }

    if let Err(error) = license::local_license_allows_run() {
        set_running(&state, false)?;
        return Err(error);
    }

    let state_for_thread = state.inner().clone();
    thread::spawn(move || {
        if let Err(error) =
            run_transcription(app.clone(), state_for_thread.clone(), request, status)
        {
            let _ = emit_event(&app, "failed", "system", &error, "Echec", 0);
        }
        let _ = set_running_direct(&state_for_thread, false);
        state_for_thread
            .cancel_requested
            .store(false, Ordering::SeqCst);
    });

    Ok(StartResponse { started: true })
}

#[tauri::command]
pub fn cancel_transcription(
    app: AppHandle,
    state: State<TranscriptionState>,
) -> Result<CancelResponse, String> {
    state.cancel_requested.store(true, Ordering::SeqCst);
    let mut cancelled = false;
    if let Ok(mut active_child) = state.active_child.lock() {
        if let Some(child) = active_child.as_mut() {
            let _ = child.kill();
            cancelled = true;
        }
    }
    emit_event(
        &app,
        "cancelled",
        "system",
        "Transcription annulée.",
        "Annulé",
        0,
    )?;
    Ok(CancelResponse { cancelled })
}

fn run_transcription(
    app: AppHandle,
    state: TranscriptionState,
    request: TranscriptionRequest,
    status: EngineStatus,
) -> Result<(), String> {
    let audio = PathBuf::from(request.audio_path.trim());
    if !audio.exists() {
        return Err(format!(
            "Fichier audio introuvable: {}",
            audio.to_string_lossy()
        ));
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

    let paths = TranscriptionPaths {
        wav: paths::work_wav_path(&audio, &work_dir),
        audio,
        output_dir,
        work_dir,
    };

    let result = (|| {
        ensure_not_cancelled(&state)?;
        emit_event(
            &app,
            "started",
            "system",
            "Backend natif whisper.cpp initialisé.",
            "Préparation",
            5,
        )?;

        let model_path =
            model_assets::resolve_model_path(Path::new(&status.engine_root), &request.model);
        if !model_path.exists {
            return Err(format!(
                "Modèle requis introuvable: {}. Téléchargez le modèle dans Réglages ou déposez un fichier GGML/GGUF dans le dossier modèles.",
                model_path.path.to_string_lossy()
            ));
        }

        prepare_wav(&app, &state, &paths, &request, Path::new(&status.ffmpeg))?;
        ensure_not_cancelled(&state)?;
        let transcript = run_whisper_cpp(
            &app,
            &state,
            &paths,
            &request,
            Path::new(&status.whisper_cli),
            &model_path.path,
        )?;
        ensure_not_cancelled(&state)?;
        emit_event(
            &app,
            "log",
            "system",
            "Génération des exports...",
            "Exports",
            92,
        )?;
        let outputs = write_outputs(&paths, &transcript)?;
        append_history(
            &paths,
            &request,
            &outputs,
            transcript.duration_seconds,
            "success",
        )?;
        cleanup_temporary_wav(&app, &paths)?;

        emit_event(
            &app,
            "completed",
            "system",
            "Process terminé.",
            "Terminé",
            100,
        )?;
        Ok(())
    })();

    if result.is_err() {
        let _ = cleanup_temporary_wav(&app, &paths);
    }
    result
}

fn prepare_wav(
    app: &AppHandle,
    state: &TranscriptionState,
    paths: &TranscriptionPaths,
    request: &TranscriptionRequest,
    ffmpeg: &Path,
) -> Result<(), String> {
    let metadata_path = paths.wav.with_extension("wav.meta.json");
    let signature = audio_preprocess_signature(request);
    if !request.force
        && paths.wav.exists()
        && paths
            .wav
            .wav_metadata_is_fresh(&paths.audio, &metadata_path, &signature)
    {
        emit_event(
            app,
            "log",
            "system",
            &format!(
                "Using existing preprocessed WAV: {}",
                paths.wav.to_string_lossy()
            ),
            "Audio préparé",
            15,
        )?;
        return Ok(());
    }

    emit_event(
        app,
        "log",
        "system",
        "Preparing clean 16 kHz mono WAV for ASR...",
        "Préparation audio",
        10,
    )?;
    if let Some(parent) = paths.wav.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        paths.audio.to_string_lossy().to_string(),
        "-vn".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-ar".to_string(),
        "16000".to_string(),
    ];
    if let Some(filter) = build_audio_filter(request) {
        args.extend(["-af".to_string(), filter]);
    }
    args.extend([
        "-c:a".to_string(),
        "pcm_s16le".to_string(),
        paths.wav.to_string_lossy().to_string(),
    ]);

    emit_event(
        app,
        "log",
        "system",
        &command_preview(ffmpeg, &args),
        "Préparation audio",
        10,
    )?;
    let mut command = Command::new(ffmpeg);
    command.args(&args);
    configure_child_binary_env(&mut command, ffmpeg);
    run_logged_command(
        app.clone(),
        state,
        command,
        CommandKind::Ffmpeg,
        "Impossible de convertir l'audio avec FFmpeg",
    )?;

    let metadata = json!({ "signature": signature });
    fs::write(
        metadata_path,
        serde_json::to_string_pretty(&metadata).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn run_whisper_cpp(
    app: &AppHandle,
    state: &TranscriptionState,
    paths: &TranscriptionPaths,
    request: &TranscriptionRequest,
    whisper_cli: &Path,
    model_path: &Path,
) -> Result<NativeTranscript, String> {
    let output_base = paths.work_dir.join(format!(
        "{}.whispercpp",
        paths::transcript_output_stem(&paths.audio)
    ));
    let raw_json_path = output_base.with_extension("json");
    let raw_srt_path = output_base.with_extension("srt");

    if request.force {
        let _ = fs::remove_file(&raw_json_path);
        let _ = fs::remove_file(&raw_srt_path);
    }

    let language = normalize_language(&request.language);
    let mut args = vec![
        "-m".to_string(),
        model_path.to_string_lossy().to_string(),
        "-f".to_string(),
        paths.wav.to_string_lossy().to_string(),
        "-l".to_string(),
        language.clone(),
        "-oj".to_string(),
        "-osrt".to_string(),
        "-of".to_string(),
        output_base.to_string_lossy().to_string(),
        "-pp".to_string(),
    ];
    if request.threads > 0 {
        args.extend(["-t".to_string(), request.threads.to_string()]);
    }
    if request.device == "cpu" {
        args.push("-ng".to_string());
    }

    emit_event(
        app,
        "log",
        "system",
        "Loading whisper.cpp model...",
        "Chargement modèle",
        25,
    )?;
    emit_event(
        app,
        "log",
        "system",
        &command_preview(whisper_cli, &args),
        "Transcription",
        35,
    )?;
    let mut command = Command::new(whisper_cli);
    command.args(&args).current_dir(&paths.work_dir);
    configure_child_binary_env(&mut command, whisper_cli);
    run_logged_command(
        app.clone(),
        state,
        command,
        CommandKind::Whisper,
        "whisper-cli a échoué",
    )?;

    let mut transcript = if raw_json_path.exists() {
        parse_whisper_json(&raw_json_path)?
    } else if raw_srt_path.exists() {
        parse_srt_transcript(&raw_srt_path, &language)?
    } else {
        return Err(format!(
            "whisper-cli n'a pas produit de JSON/SRT attendu sous {}",
            output_base.to_string_lossy()
        ));
    };

    transcript.backend = BACKEND_NAME.to_string();
    transcript.model = request.model.clone();
    transcript.model_path = model_path.to_string_lossy().to_string();
    transcript.source_audio = paths.audio.to_string_lossy().to_string();
    transcript.preprocessed_wav = paths.wav.to_string_lossy().to_string();
    if transcript.language.is_empty() {
        transcript.language = language;
    }
    transcript.text = transcript_text(&transcript.segments);
    transcript.duration_seconds = transcript.segments.last().map(|segment| segment.end);
    Ok(transcript)
}

fn write_outputs(
    paths: &TranscriptionPaths,
    transcript: &NativeTranscript,
) -> Result<Vec<PathBuf>, String> {
    let stem = paths::transcript_output_stem(&paths.audio);
    let txt = paths.output_dir.join(format!("{stem}.transcript.txt"));
    let md = paths.output_dir.join(format!("{stem}.transcript.md"));
    let clean_txt = paths.output_dir.join(format!("{stem}.clean.txt"));
    let srt = paths.output_dir.join(format!("{stem}.segments.srt"));
    let segments_json = paths.output_dir.join(format!("{stem}.segments.json"));
    let docx = paths.output_dir.join(format!("{stem}.transcript.docx"));
    let raw_json = paths.output_dir.join(format!("{stem}.whispercpp.json"));

    write_timestamped_txt(&txt, &transcript.segments)?;
    write_markdown(&md, transcript, &paths.audio)?;
    write_clean_txt(&clean_txt, transcript)?;
    write_srt(&srt, &transcript.segments)?;
    write_segments_json(&segments_json, transcript)?;
    write_docx(&docx, transcript, &paths.audio)?;
    fs::write(
        &raw_json,
        serde_json::to_string_pretty(transcript).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let outputs = vec![txt, md, clean_txt, srt, segments_json, docx, raw_json];
    println_outputs(&outputs);
    Ok(outputs)
}

fn append_history(
    paths: &TranscriptionPaths,
    request: &TranscriptionRequest,
    output_paths: &[PathBuf],
    duration_seconds: Option<f64>,
    status: &str,
) -> Result<(), String> {
    let history = paths.output_dir.join("transcription-history.jsonl");
    let record = json!({
        "created_at": Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        "status": status,
        "source_audio": paths.audio.to_string_lossy(),
        "stem": paths::transcript_output_stem(&paths.audio),
        "duration_seconds": duration_seconds,
        "language": request.language,
        "model": request.model,
        "asr_backend": BACKEND_NAME,
        "diarization": false,
        "outputs": output_paths.iter().map(|path| path.to_string_lossy().to_string()).collect::<Vec<_>>(),
    });
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&history)
        .map_err(|error| error.to_string())?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&record).map_err(|error| error.to_string())?
    )
    .map_err(|error| error.to_string())?;
    println!("History updated: {}", history.to_string_lossy());
    Ok(())
}

fn run_logged_command(
    app: AppHandle,
    state: &TranscriptionState,
    mut command: Command,
    kind: CommandKind,
    failure_context: &str,
) -> Result<(), String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| command_spawn_error(kind, failure_context, &error.to_string()))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_handle = stdout.map(|stream| spawn_reader(app.clone(), "stdout", stream));
    let stderr_handle = stderr.map(|stream| spawn_reader(app.clone(), "stderr", stream));

    {
        let mut active_child = state
            .active_child
            .lock()
            .map_err(|_| "Etat process indisponible.".to_string())?;
        *active_child = Some(child);
    }

    let timeout = command_timeout();
    let started_at = Instant::now();
    let status = loop {
        ensure_not_cancelled(state)?;
        {
            let mut active_child = state
                .active_child
                .lock()
                .map_err(|_| "Etat process indisponible.".to_string())?;
            let Some(child) = active_child.as_mut() else {
                return Err("Process externe interrompu.".to_string());
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    *active_child = None;
                    break status;
                }
                Ok(None) => {}
                Err(error) => {
                    let _ = child.kill();
                    *active_child = None;
                    return Err(format!("{failure_context}: {error}"));
                }
            }
        }

        if started_at.elapsed() > timeout {
            if let Ok(mut active_child) = state.active_child.lock() {
                if let Some(child) = active_child.as_mut() {
                    let _ = child.kill();
                }
                *active_child = None;
            }
            return Err(format!(
                "{failure_context}: délai dépassé après {}.",
                format_duration_human(timeout)
            ));
        }
        thread::sleep(Duration::from_millis(200));
    };

    if let Some(handle) = stdout_handle {
        let _ = handle.join();
    }
    if let Some(handle) = stderr_handle {
        let _ = handle.join();
    }

    if status.success() {
        Ok(())
    } else {
        Err(command_exit_error(kind, failure_context, status.code()))
    }
}

#[derive(Debug, Clone, Copy)]
enum CommandKind {
    Ffmpeg,
    Whisper,
}

fn ensure_not_cancelled(state: &TranscriptionState) -> Result<(), String> {
    if state.cancel_requested.load(Ordering::SeqCst) {
        Err("Transcription annulée.".to_string())
    } else {
        Ok(())
    }
}

fn command_timeout() -> Duration {
    env::var("MICROWEST_TRANSCRIPTION_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|seconds| *seconds > 0)
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(DEFAULT_COMMAND_TIMEOUT_SECONDS))
}

fn command_spawn_error(kind: CommandKind, context: &str, error: &str) -> String {
    match kind {
        CommandKind::Ffmpeg => format!(
            "{context}: FFmpeg est introuvable ou impossible à lancer. Vérifiez que le binaire FFmpeg est présent dans le bundle pour cette plateforme. Détail: {error}"
        ),
        CommandKind::Whisper => format!(
            "{context}: whisper-cli est introuvable, non exécutable ou incompatible avec cette machine. Vérifiez le bundle {}/{} et l'architecture du binaire. Détail: {error}",
            env::consts::OS,
            env::consts::ARCH
        ),
    }
}

fn command_exit_error(kind: CommandKind, context: &str, code: Option<i32>) -> String {
    let code = code.map_or_else(|| "inconnu".to_string(), |code| code.to_string());
    match kind {
        CommandKind::Ffmpeg => format!(
            "{context}. FFmpeg a refusé le fichier audio ou le binaire est incompatible. Code {code}."
        ),
        CommandKind::Whisper => format!(
            "{context}. whisper-cli a échoué avec le modèle ou le WAV généré. Si le message parle de format modèle ou de CPU, utilisez un modèle GGML/GGUF compatible avec ce build. Code {code}."
        ),
    }
}

fn format_duration_human(duration: Duration) -> String {
    let total = duration.as_secs();
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let seconds = total % 60;
    if hours > 0 {
        format!("{hours}h {minutes}min")
    } else if minutes > 0 {
        format!("{minutes}min {seconds}s")
    } else {
        format!("{seconds}s")
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
        ("Loading whisper.cpp model", "Chargement modèle", 25),
        ("whisper_init", "Chargement modèle", 30),
        ("system_info", "Chargement modèle", 30),
        ("main: processing", "Transcription", 35),
        ("progress", "Transcription", 55),
        ("output_json", "Ecriture des résultats", 90),
        ("output_srt", "Ecriture des résultats", 90),
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

fn build_engine_status(app: Option<&AppHandle>) -> EngineStatus {
    let engine_root = find_engine_root(app);
    let data_root = default_data_root(&engine_root);
    let default_output_dir = paths::default_output_dir(&data_root);
    let default_work_dir = paths::default_work_dir(&data_root);
    let whisper_cli = find_whisper_cli(&engine_root);
    let ffmpeg = find_ffmpeg(&engine_root);
    let model_path = model_assets::resolve_status_model_path(&engine_root);

    let mut missing = Vec::new();
    if !whisper_cli.exists {
        missing.push(format!("whisper-cli ({})", platform_tag()));
    }
    if !ffmpeg.exists {
        missing.push(format!("FFmpeg ({})", platform_tag()));
    }
    let can_run = missing.is_empty();
    let message = if can_run && model_path.exists {
        "Backend natif whisper.cpp prêt.".to_string()
    } else if can_run {
        "Backend natif prêt. Téléchargez un modèle dans Réglages.".to_string()
    } else {
        format!(
            "Composants audio manquants ou incompatibles dans ce build: {}.",
            missing.join(", ")
        )
    };

    EngineStatus {
        backend: BACKEND_NAME.to_string(),
        engine_root: engine_root.to_string_lossy().to_string(),
        whisper_cli: whisper_cli.path.to_string_lossy().to_string(),
        ffmpeg: ffmpeg.path.to_string_lossy().to_string(),
        model_path: model_path.path.to_string_lossy().to_string(),
        default_model: model_assets::DEFAULT_MODEL.to_string(),
        default_output_dir: default_output_dir.to_string_lossy().to_string(),
        default_work_dir: default_work_dir.to_string_lossy().to_string(),
        platform: env::consts::OS.to_string(),
        architecture: env::consts::ARCH.to_string(),
        can_run,
        message,
    }
}

#[derive(Debug)]
struct ResolvedPath {
    path: PathBuf,
    exists: bool,
}

fn find_engine_root(app: Option<&AppHandle>) -> PathBuf {
    if let Ok(path) = env::var("MICROWEST_WHISPER_CPP_ROOT") {
        return PathBuf::from(path);
    }

    let mut candidates = Vec::new();
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(resource_dir.join("engine").join("whispercpp"));
        }
    }
    for root in repo_candidates() {
        candidates.push(root.join("engine").join("whispercpp"));
    }

    candidates
        .iter()
        .find(|candidate| candidate.exists())
        .cloned()
        .unwrap_or_else(|| repo_root().join("engine").join("whispercpp"))
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn repo_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![repo_root()];
    if let Ok(current) = env::current_dir() {
        candidates.push(current.clone());
        if let Some(parent) = current.parent() {
            candidates.push(parent.to_path_buf());
            if let Some(grand_parent) = parent.parent() {
                candidates.push(grand_parent.to_path_buf());
            }
        }
    }
    candidates
}

fn default_data_root(engine_root: &Path) -> PathBuf {
    if engine_root.file_name().and_then(|value| value.to_str()) == Some("whispercpp") {
        if let Some(engine_dir) = engine_root.parent() {
            if engine_dir.file_name().and_then(|value| value.to_str()) == Some("engine") {
                if let Some(repo_root) = engine_dir.parent() {
                    return repo_root.to_path_buf();
                }
            }
        }
    }
    repo_root()
}

fn find_whisper_cli(engine_root: &Path) -> ResolvedPath {
    find_executable(
        "MICROWEST_WHISPER_CLI",
        engine_root,
        &["whisper-cli", "main"],
        "whisper-cli",
    )
}

fn find_ffmpeg(engine_root: &Path) -> ResolvedPath {
    find_executable("MICROWEST_FFMPEG", engine_root, &["ffmpeg"], "ffmpeg")
}

fn find_executable(
    env_name: &str,
    engine_root: &Path,
    base_names: &[&str],
    path_name: &str,
) -> ResolvedPath {
    if let Ok(path) = env::var(env_name) {
        let path = PathBuf::from(path);
        return ResolvedPath {
            exists: path.exists(),
            path,
        };
    }

    for dir in bundled_binary_dirs(engine_root) {
        for base_name in base_names {
            let path = dir.join(executable_name(base_name));
            if path.exists() {
                return ResolvedPath { path, exists: true };
            }
        }
    }

    if let Some(path) = find_on_path(path_name) {
        return ResolvedPath { path, exists: true };
    }

    let fallback = bundled_binary_dirs(engine_root)
        .into_iter()
        .next()
        .unwrap_or_else(|| engine_root.join("bin"))
        .join(executable_name(path_name));
    ResolvedPath {
        path: fallback,
        exists: false,
    }
}

fn bundled_binary_dirs(engine_root: &Path) -> Vec<PathBuf> {
    let platform = platform_tag();
    vec![
        engine_root.join("bin").join(&platform),
        engine_root.join("bin").join(env::consts::OS),
        engine_root.join("bin"),
    ]
}

fn platform_tag() -> String {
    let os = match env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        other => other,
    };
    format!("{os}-{}", env::consts::ARCH)
}

fn executable_name(base: &str) -> String {
    if cfg!(target_os = "windows") && !base.ends_with(".exe") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
    let path_env = env::var_os("PATH")?;
    let executable = executable_name(name);
    env::split_paths(&path_env)
        .map(|path| path.join(&executable))
        .find(|path| path.exists())
}

fn configure_child_binary_env(command: &mut Command, executable: &Path) {
    let Some(binary_dir) = executable.parent() else {
        return;
    };
    let variable = if cfg!(target_os = "windows") {
        "PATH"
    } else if cfg!(target_os = "macos") {
        "DYLD_LIBRARY_PATH"
    } else {
        "LD_LIBRARY_PATH"
    };

    let mut paths = vec![binary_dir.to_path_buf()];
    if let Some(existing) = env::var_os(variable) {
        paths.extend(env::split_paths(&existing));
    }
    if let Ok(joined) = env::join_paths(paths) {
        command.env(variable, joined);
    }
}

fn audio_preprocess_signature(request: &TranscriptionRequest) -> Value {
    json!({
        "version": 1,
        "audio_filter": request.audio_filter,
        "trim_silence": request.trim_silence,
    })
}

trait WavFreshness {
    fn wav_metadata_is_fresh(
        &self,
        source_audio: &Path,
        metadata_path: &Path,
        signature: &Value,
    ) -> bool;
}

impl WavFreshness for PathBuf {
    fn wav_metadata_is_fresh(
        &self,
        source_audio: &Path,
        metadata_path: &Path,
        signature: &Value,
    ) -> bool {
        if !self.exists() {
            return false;
        }
        let Ok(wav_meta) = self.metadata() else {
            return false;
        };
        let Ok(audio_meta) = source_audio.metadata() else {
            return false;
        };
        let Ok(wav_modified) = wav_meta.modified() else {
            return false;
        };
        let Ok(audio_modified) = audio_meta.modified() else {
            return false;
        };
        if wav_modified < audio_modified {
            return false;
        }
        let Ok(content) = fs::read_to_string(metadata_path) else {
            return false;
        };
        let Ok(metadata) = serde_json::from_str::<Value>(&content) else {
            return false;
        };
        metadata.get("signature") == Some(signature)
    }
}

fn build_audio_filter(request: &TranscriptionRequest) -> Option<String> {
    let mut filters = Vec::new();
    if request.trim_silence {
        filters.push("silenceremove=start_periods=1:start_duration=0.2:start_threshold=-45dB");
    }
    match request.audio_filter.as_str() {
        "loudnorm" => filters.push("loudnorm=I=-16:TP=-1.5:LRA=11"),
        "voice-clean" => filters.extend([
            "highpass=f=80",
            "lowpass=f=7800",
            "afftdn=nf=-25",
            "loudnorm=I=-16:TP=-1.5:LRA=11",
        ]),
        _ => {}
    }
    (!filters.is_empty()).then(|| filters.join(","))
}

fn cleanup_temporary_wav(app: &AppHandle, paths: &TranscriptionPaths) -> Result<(), String> {
    if env::var("MICROWEST_KEEP_TEMP_WAV").ok().as_deref() == Some("1") {
        return Ok(());
    }
    let metadata_path = paths.wav.with_extension("wav.meta.json");
    let mut removed = Vec::new();
    for path in [&paths.wav, &metadata_path] {
        if path.exists() {
            fs::remove_file(path).map_err(|error| {
                format!(
                    "Impossible de nettoyer le fichier temporaire {}: {error}",
                    path.to_string_lossy()
                )
            })?;
            removed.push(path.to_string_lossy().to_string());
        }
    }
    if !removed.is_empty() {
        emit_event(
            app,
            "log",
            "system",
            "Fichiers temporaires nettoyés.",
            "Nettoyage",
            99,
        )?;
    }
    Ok(())
}

fn normalize_language(language: &str) -> String {
    let language = language.trim();
    if language.is_empty() {
        "auto".to_string()
    } else {
        language.to_string()
    }
}

fn command_preview(program: &Path, args: &[String]) -> String {
    let mut parts = vec![quote_arg(&program.to_string_lossy())];
    parts.extend(args.iter().map(|arg| quote_arg(arg)));
    format!("+ {}", parts.join(" "))
}

fn quote_arg(value: &str) -> String {
    if value.contains(' ') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn parse_whisper_json(path: &Path) -> Result<NativeTranscript, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let value = serde_json::from_str::<Value>(&content).map_err(|error| error.to_string())?;
    let language = value
        .pointer("/result/language")
        .or_else(|| value.get("language"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let segments: Vec<TranscriptSegment> = value
        .get("segments")
        .and_then(Value::as_array)
        .map(|segments| parse_generic_segments(segments))
        .or_else(|| {
            value
                .get("transcription")
                .and_then(Value::as_array)
                .map(|segments| parse_whisper_cpp_segments(segments))
        })
        .unwrap_or_default();

    if segments.is_empty() {
        return Err(format!(
            "Aucun segment exploitable dans {}",
            path.to_string_lossy()
        ));
    }

    let text = value
        .get("text")
        .and_then(Value::as_str)
        .map(clean_text)
        .unwrap_or_else(|| transcript_text(&segments));

    Ok(NativeTranscript {
        backend: BACKEND_NAME.to_string(),
        model: String::new(),
        model_path: String::new(),
        language,
        source_audio: String::new(),
        preprocessed_wav: String::new(),
        duration_seconds: segments.last().map(|segment| segment.end),
        text,
        segments,
    })
}

fn parse_generic_segments(segments: &[Value]) -> Vec<TranscriptSegment> {
    segments
        .iter()
        .filter_map(|segment| {
            let text = clean_text(segment.get("text")?.as_str()?);
            if text.is_empty() {
                return None;
            }
            Some(TranscriptSegment {
                start: number_field(segment, "start").unwrap_or(0.0),
                end: number_field(segment, "end").unwrap_or(0.0),
                text,
            })
        })
        .collect()
}

fn parse_whisper_cpp_segments(segments: &[Value]) -> Vec<TranscriptSegment> {
    segments
        .iter()
        .filter_map(|segment| {
            let text = clean_text(segment.get("text")?.as_str()?);
            if text.is_empty() {
                return None;
            }
            let start = segment
                .pointer("/offsets/from")
                .and_then(number_value)
                .map(|value| value / 1000.0)
                .or_else(|| {
                    segment
                        .pointer("/timestamps/from")
                        .and_then(timestamp_value)
                })
                .or_else(|| number_field(segment, "start"))
                .unwrap_or(0.0);
            let end = segment
                .pointer("/offsets/to")
                .and_then(number_value)
                .map(|value| value / 1000.0)
                .or_else(|| segment.pointer("/timestamps/to").and_then(timestamp_value))
                .or_else(|| number_field(segment, "end"))
                .unwrap_or(start);
            Some(TranscriptSegment { start, end, text })
        })
        .collect()
}

fn parse_srt_transcript(path: &Path, language: &str) -> Result<NativeTranscript, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let segments = parse_srt_segments(&content);
    if segments.is_empty() {
        return Err(format!(
            "Aucun segment exploitable dans {}",
            path.to_string_lossy()
        ));
    }
    Ok(NativeTranscript {
        backend: BACKEND_NAME.to_string(),
        model: String::new(),
        model_path: String::new(),
        language: language.to_string(),
        source_audio: String::new(),
        preprocessed_wav: String::new(),
        duration_seconds: segments.last().map(|segment| segment.end),
        text: transcript_text(&segments),
        segments,
    })
}

fn parse_srt_segments(content: &str) -> Vec<TranscriptSegment> {
    content
        .split("\n\n")
        .filter_map(|block| {
            let mut lines = block.lines().filter(|line| !line.trim().is_empty());
            let first = lines.next()?.trim();
            let time_line = if first.contains("-->") {
                first
            } else {
                lines.next()?.trim()
            };
            let (start, end) = time_line.split_once("-->")?;
            let text = clean_text(&lines.collect::<Vec<_>>().join(" "));
            if text.is_empty() {
                return None;
            }
            Some(TranscriptSegment {
                start: parse_timestamp(start.trim()).unwrap_or(0.0),
                end: parse_timestamp(end.trim()).unwrap_or(0.0),
                text,
            })
        })
        .collect()
}

fn number_field(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(number_value)
}

fn number_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|value| value as f64))
        .or_else(|| value.as_u64().map(|value| value as f64))
}

fn timestamp_value(value: &Value) -> Option<f64> {
    value.as_str().and_then(parse_timestamp)
}

fn parse_timestamp(value: &str) -> Option<f64> {
    let value = value.trim().replace(',', ".");
    let parts = value.split(':').collect::<Vec<_>>();
    match parts.as_slice() {
        [hours, minutes, seconds] => Some(
            hours.parse::<f64>().ok()? * 3600.0
                + minutes.parse::<f64>().ok()? * 60.0
                + seconds.parse::<f64>().ok()?,
        ),
        [minutes, seconds] => {
            Some(minutes.parse::<f64>().ok()? * 60.0 + seconds.parse::<f64>().ok()?)
        }
        [seconds] => seconds.parse::<f64>().ok(),
        _ => None,
    }
}

fn clean_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn transcript_text(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .map(|segment| segment.text.as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn format_ts(seconds: f64, sep: &str) -> String {
    let milliseconds = (seconds.max(0.0) * 1000.0).round() as u64;
    let hours = milliseconds / 3_600_000;
    let minutes = (milliseconds % 3_600_000) / 60_000;
    let secs = (milliseconds % 60_000) / 1000;
    let millis = milliseconds % 1000;
    format!("{hours:02}:{minutes:02}:{secs:02}{sep}{millis:03}")
}

fn write_timestamped_txt(path: &Path, segments: &[TranscriptSegment]) -> Result<(), String> {
    let mut content = String::new();
    for segment in segments {
        content.push_str(&format!(
            "[{} - {}] {}\n\n",
            format_ts(segment.start, "."),
            format_ts(segment.end, "."),
            segment.text
        ));
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn write_markdown(path: &Path, transcript: &NativeTranscript, source: &Path) -> Result<(), String> {
    let mut content = format!(
        "# Transcription\n\nSource: `{}`\n\nBackend: `{}`\n\nModèle: `{}`\n\n",
        source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("audio"),
        transcript.backend,
        transcript.model,
    );
    for segment in &transcript.segments {
        content.push_str(&format!(
            "`{} - {}`\n\n{}\n\n",
            format_ts(segment.start, "."),
            format_ts(segment.end, "."),
            segment.text
        ));
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn write_clean_txt(path: &Path, transcript: &NativeTranscript) -> Result<(), String> {
    fs::write(path, transcript.text.trim()).map_err(|error| error.to_string())
}

fn write_srt(path: &Path, segments: &[TranscriptSegment]) -> Result<(), String> {
    let mut content = String::new();
    for (index, segment) in segments.iter().enumerate() {
        content.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            index + 1,
            format_ts(segment.start, ","),
            format_ts(segment.end, ","),
            segment.text
        ));
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn write_segments_json(path: &Path, transcript: &NativeTranscript) -> Result<(), String> {
    fs::write(
        path,
        serde_json::to_string_pretty(transcript).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn write_docx(path: &Path, transcript: &NativeTranscript, source: &Path) -> Result<(), String> {
    let file = File::create(path).map_err(|error| error.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

    zip.start_file("[Content_Types].xml", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(content_types_xml().as_bytes())
        .map_err(|error| error.to_string())?;

    zip.start_file("_rels/.rels", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(root_rels_xml().as_bytes())
        .map_err(|error| error.to_string())?;

    zip.start_file("docProps/app.xml", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(app_props_xml().as_bytes())
        .map_err(|error| error.to_string())?;

    zip.start_file("docProps/core.xml", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(core_props_xml().as_bytes())
        .map_err(|error| error.to_string())?;

    zip.start_file("word/document.xml", options)
        .map_err(|error| error.to_string())?;
    zip.write_all(document_xml(transcript, source).as_bytes())
        .map_err(|error| error.to_string())?;

    zip.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn content_types_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"#
}

fn root_rels_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"#
}

fn app_props_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microwest Whisper</Application>
</Properties>"#
}

fn core_props_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Transcription</dc:title>
  <dc:creator>Microwest Whisper</dc:creator>
  <cp:lastModifiedBy>Microwest Whisper</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{}</dcterms:modified>
</cp:coreProperties>"#,
        Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
    )
}

fn document_xml(transcript: &NativeTranscript, source: &Path) -> String {
    let mut body = String::new();
    body.push_str(&docx_paragraph("Transcription", true));
    body.push_str(&docx_paragraph(
        &format!(
            "Source: {}",
            source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("audio")
        ),
        false,
    ));
    body.push_str(&docx_paragraph(
        &format!(
            "Backend: {} | Modèle: {}",
            transcript.backend, transcript.model
        ),
        false,
    ));
    for segment in &transcript.segments {
        body.push_str(&docx_paragraph(
            &format!(
                "{} - {}",
                format_ts(segment.start, "."),
                format_ts(segment.end, ".")
            ),
            true,
        ));
        body.push_str(&docx_paragraph(&segment.text, false));
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>"#,
        body
    )
}

fn docx_paragraph(text: &str, bold: bool) -> String {
    let run_props = if bold { "<w:rPr><w:b/></w:rPr>" } else { "" };
    format!(
        "<w:p><w:r>{run_props}<w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
        xml_escape(text)
    )
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn println_outputs(outputs: &[PathBuf]) {
    println!();
    println!("Done. Files written:");
    for path in outputs {
        println!("- {}", path.to_string_lossy());
    }
}

fn set_running(state: &State<TranscriptionState>, value: bool) -> Result<(), String> {
    set_running_direct(state.inner(), value)
}

fn set_running_direct(state: &TranscriptionState, value: bool) -> Result<(), String> {
    let mut running = state
        .running
        .lock()
        .map_err(|_| "Etat process indisponible.".to_string())?;
    *running = value;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_whisper_cpp_json_transcription_shape() {
        let segments = parse_whisper_cpp_segments(&[json!({
            "timestamps": { "from": "00:00:01,000", "to": "00:00:02,500" },
            "offsets": { "from": 1000, "to": 2500 },
            "text": " Bonjour   tout le monde "
        })]);

        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].start, 1.0);
        assert_eq!(segments[0].end, 2.5);
        assert_eq!(segments[0].text, "Bonjour tout le monde");
    }

    #[test]
    fn parses_srt_segments_without_speakers() {
        let segments = parse_srt_segments(
            "1\n00:00:00,000 --> 00:00:01,250\nBonjour\n\n2\n00:00:01,250 --> 00:00:02,000\nSuite\n",
        );

        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].text, "Bonjour");
        assert_eq!(segments[1].start, 1.25);
    }

    #[test]
    fn writes_expected_exports_without_diarization() {
        let root = env::temp_dir().join(format!("microwest-export-test-{}", uuid::Uuid::new_v4()));
        let output_dir = root.join("out");
        let work_dir = root.join("work");
        fs::create_dir_all(&output_dir).unwrap();
        fs::create_dir_all(&work_dir).unwrap();
        let audio = root.join("meeting.wav");
        fs::write(&audio, b"audio").unwrap();
        let paths = TranscriptionPaths {
            audio: audio.clone(),
            output_dir: output_dir.clone(),
            work_dir,
            wav: root.join("meeting.prepared.wav"),
        };
        let transcript = NativeTranscript {
            backend: BACKEND_NAME.to_string(),
            model: "large-v3-turbo-q8_0".to_string(),
            model_path: "/models/ggml-large-v3-turbo-q8_0.bin".to_string(),
            language: "fr".to_string(),
            source_audio: audio.to_string_lossy().to_string(),
            preprocessed_wav: paths.wav.to_string_lossy().to_string(),
            duration_seconds: Some(2.0),
            text: "Bonjour\n\nSuite".to_string(),
            segments: vec![
                TranscriptSegment {
                    start: 0.0,
                    end: 1.25,
                    text: "Bonjour".to_string(),
                },
                TranscriptSegment {
                    start: 1.25,
                    end: 2.0,
                    text: "Suite".to_string(),
                },
            ],
        };

        let outputs = write_outputs(&paths, &transcript).unwrap();

        assert_eq!(outputs.len(), 7);
        assert!(outputs
            .iter()
            .any(|path| path.to_string_lossy().ends_with(".transcript.md")));
        assert!(outputs
            .iter()
            .any(|path| path.to_string_lossy().ends_with(".clean.txt")));
        assert!(outputs
            .iter()
            .any(|path| path.to_string_lossy().ends_with(".segments.srt")));
        assert!(outputs
            .iter()
            .any(|path| path.to_string_lossy().ends_with(".transcript.docx")));
        let markdown_path = outputs
            .iter()
            .find(|path| path.to_string_lossy().ends_with(".transcript.md"))
            .unwrap();
        let markdown = fs::read_to_string(markdown_path).unwrap();
        assert!(markdown.contains("Backend: `whisper.cpp`"));
        assert!(!markdown.contains("SPEAKER_"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn maps_whisper_failure_to_actionable_error() {
        let message = command_exit_error(CommandKind::Whisper, "whisper-cli a échoué", Some(1));

        assert!(message.contains("whisper-cli"));
        assert!(message.contains("GGML/GGUF"));
        assert!(message.contains("Code 1"));
    }

    #[test]
    fn maps_ffmpeg_spawn_failure_to_actionable_error() {
        let message =
            command_spawn_error(CommandKind::Ffmpeg, "Conversion impossible", "not found");

        assert!(message.contains("FFmpeg"));
        assert!(message.contains("présent dans le bundle"));
        assert!(message.contains("not found"));
    }
}
