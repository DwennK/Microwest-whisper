use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    env,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

pub const DEFAULT_MODEL: &str = "large-v3-turbo-q8_0";

const MODEL_DIR_ENV: &str = "MICROWEST_MODEL_DIR";
const MODEL_ENV: &str = "MICROWEST_WHISPER_MODEL";
const HF_BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

#[derive(Clone, Copy)]
struct ModelSpec {
    id: &'static str,
    label: &'static str,
    filename: &'static str,
    size_bytes: u64,
    size_label: &'static str,
    sha256: &'static str,
}

const MODEL_SPECS: &[ModelSpec] = &[
    ModelSpec {
        id: "large-v3-turbo-q8_0",
        label: "large-v3-turbo q8_0",
        filename: "ggml-large-v3-turbo-q8_0.bin",
        size_bytes: 874_188_075,
        size_label: "834 MiB",
        sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1",
    },
    ModelSpec {
        id: "large-v3-turbo-q5_0",
        label: "large-v3-turbo q5_0",
        filename: "ggml-large-v3-turbo-q5_0.bin",
        size_bytes: 574_041_195,
        size_label: "547 MiB",
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    },
];

#[derive(Debug, Serialize, Clone)]
pub struct ResolvedModelPath {
    pub path: PathBuf,
    pub exists: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ModelInfo {
    id: String,
    label: String,
    filename: String,
    url: String,
    size_bytes: u64,
    size_label: String,
    installed: bool,
    path: String,
    source: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ModelInventory {
    models_dir: String,
    total_downloaded_bytes: u64,
    models: Vec<ModelInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ModelDownloadEvent {
    kind: String,
    model: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    progress: u8,
    line: String,
    path: String,
}

pub fn model_status(engine_root: &Path) -> ModelInventory {
    let models_dir = downloaded_models_dir();
    let models = MODEL_SPECS
        .iter()
        .map(|spec| {
            let resolved = resolve_model_path(engine_root, spec.id);
            ModelInfo {
                id: spec.id.to_string(),
                label: spec.label.to_string(),
                filename: spec.filename.to_string(),
                url: model_url(spec),
                size_bytes: spec.size_bytes,
                size_label: spec.size_label.to_string(),
                installed: resolved.exists,
                source: model_source(engine_root, spec),
                path: resolved.path.to_string_lossy().to_string(),
            }
        })
        .collect::<Vec<_>>();

    ModelInventory {
        models_dir: models_dir.to_string_lossy().to_string(),
        total_downloaded_bytes: downloaded_models_size(&models_dir),
        models,
    }
}

pub fn models_dir_path() -> PathBuf {
    downloaded_models_dir()
}

pub async fn download_model(
    app: &AppHandle,
    engine_root: &Path,
    model: &str,
) -> Result<ModelInventory, String> {
    let spec = model_spec(model).ok_or_else(|| format!("Modèle inconnu: {model}"))?;
    let models_dir = downloaded_models_dir();
    fs::create_dir_all(&models_dir).map_err(|error| error.to_string())?;
    let destination = models_dir.join(spec.filename);

    if destination.exists() && verify_model_file(&destination, spec)? {
        emit_download_event(
            app,
            "completed",
            spec,
            spec.size_bytes,
            spec.size_bytes,
            &format!("Modèle déjà téléchargé: {}", destination.to_string_lossy()),
            &destination,
        )?;
        return Ok(model_status(engine_root));
    }

    let partial = partial_model_path(&destination);
    let _ = fs::remove_file(&partial);
    let _ = fs::remove_file(&destination);

    emit_download_event(
        app,
        "started",
        spec,
        0,
        spec.size_bytes,
        &format!("Téléchargement du modèle {}...", spec.label),
        &destination,
    )?;

    let response = reqwest::Client::new()
        .get(model_url(spec))
        .header("User-Agent", "MicrowestWhisper/0.2.0")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let total = response.content_length().unwrap_or(spec.size_bytes);
    let mut stream = response.bytes_stream();
    let mut file = File::create(&partial).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    let mut last_emit = Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        if last_emit.elapsed() >= Duration::from_millis(250) || downloaded == total {
            emit_download_event(
                app,
                "progress",
                spec,
                downloaded,
                total,
                &format!(
                    "{} / {}",
                    format_bytes(downloaded),
                    format_bytes(total.max(spec.size_bytes))
                ),
                &destination,
            )?;
            last_emit = Instant::now();
        }
    }
    file.flush().map_err(|error| error.to_string())?;
    drop(file);

    if downloaded != spec.size_bytes {
        let _ = fs::remove_file(&partial);
        return Err(format!(
            "Taille modèle invalide pour {}: {} reçu(s), {} attendu(s).",
            spec.id, downloaded, spec.size_bytes
        ));
    }

    let actual_hash = hex::encode(hasher.finalize());
    if actual_hash != spec.sha256 {
        let _ = fs::remove_file(&partial);
        return Err(format!(
            "Hash modèle invalide pour {}: {} reçu, {} attendu.",
            spec.id, actual_hash, spec.sha256
        ));
    }

    fs::rename(&partial, &destination).map_err(|error| error.to_string())?;
    emit_download_event(
        app,
        "completed",
        spec,
        spec.size_bytes,
        spec.size_bytes,
        &format!("Modèle prêt: {}", destination.to_string_lossy()),
        &destination,
    )?;
    Ok(model_status(engine_root))
}

pub fn delete_downloaded_models(engine_root: &Path) -> Result<ModelInventory, String> {
    let models_dir = downloaded_models_dir();
    for spec in MODEL_SPECS {
        let destination = models_dir.join(spec.filename);
        let partial = partial_model_path(&destination);
        if destination.exists() {
            fs::remove_file(&destination).map_err(|error| error.to_string())?;
        }
        if partial.exists() {
            fs::remove_file(&partial).map_err(|error| error.to_string())?;
        }
    }

    if models_dir.exists()
        && fs::read_dir(&models_dir)
            .map_err(|error| error.to_string())?
            .next()
            .is_none()
    {
        let _ = fs::remove_dir(&models_dir);
    }

    Ok(model_status(engine_root))
}

pub fn resolve_model_path(engine_root: &Path, requested: &str) -> ResolvedModelPath {
    if let Ok(path) = env::var(MODEL_ENV) {
        let path = PathBuf::from(path);
        return ResolvedModelPath {
            exists: path.exists(),
            path,
        };
    }

    let requested = requested.trim();
    let model_name = if requested.is_empty() || requested == "auto" {
        DEFAULT_MODEL
    } else {
        requested
    };
    let direct = PathBuf::from(model_name);
    if direct.is_absolute() || direct.components().count() > 1 {
        return ResolvedModelPath {
            exists: direct.exists(),
            path: direct,
        };
    }

    for path in bundled_model_candidates(engine_root, model_name) {
        if path.exists() {
            return ResolvedModelPath { path, exists: true };
        }
    }

    for path in downloaded_model_candidates(model_name) {
        if path.exists() {
            return ResolvedModelPath { path, exists: true };
        }
    }

    let fallback = model_spec(model_name)
        .map(|spec| downloaded_models_dir().join(spec.filename))
        .unwrap_or_else(|| downloaded_models_dir().join(format!("ggml-{model_name}.bin")));
    ResolvedModelPath {
        path: fallback,
        exists: false,
    }
}

pub fn resolve_status_model_path(engine_root: &Path) -> ResolvedModelPath {
    let default = resolve_model_path(engine_root, DEFAULT_MODEL);
    if default.exists {
        return default;
    }

    let lighter = resolve_model_path(engine_root, "large-v3-turbo-q5_0");
    if lighter.exists {
        return lighter;
    }

    default
}

fn model_spec(model: &str) -> Option<&'static ModelSpec> {
    MODEL_SPECS
        .iter()
        .find(|spec| spec.id == model || spec.filename == model)
}

fn model_url(spec: &ModelSpec) -> String {
    format!("{HF_BASE_URL}/{}", spec.filename)
}

fn model_source(engine_root: &Path, spec: &ModelSpec) -> String {
    if env::var(MODEL_ENV).ok().is_some() {
        return "env".to_string();
    }
    if bundled_model_candidates(engine_root, spec.id)
        .iter()
        .any(|path| path.exists())
    {
        return "bundled".to_string();
    }
    if downloaded_model_path(spec).exists() {
        return "downloaded".to_string();
    }
    "missing".to_string()
}

fn bundled_model_candidates(engine_root: &Path, model_name: &str) -> Vec<PathBuf> {
    let models_dir = engine_root.join("models");
    let mut candidates = vec![
        models_dir.join(model_name),
        models_dir.join(format!("{model_name}.bin")),
        models_dir.join(format!("{model_name}.gguf")),
        models_dir.join(format!("ggml-{model_name}.bin")),
        models_dir.join(format!("ggml-{model_name}.gguf")),
    ];
    if let Some(spec) = model_spec(model_name) {
        candidates.push(models_dir.join(spec.filename));
    }
    candidates
}

fn downloaded_model_candidates(model_name: &str) -> Vec<PathBuf> {
    let mut candidates = vec![
        downloaded_models_dir().join(model_name),
        downloaded_models_dir().join(format!("{model_name}.bin")),
        downloaded_models_dir().join(format!("{model_name}.gguf")),
        downloaded_models_dir().join(format!("ggml-{model_name}.bin")),
        downloaded_models_dir().join(format!("ggml-{model_name}.gguf")),
    ];
    if let Some(spec) = model_spec(model_name) {
        candidates.push(downloaded_model_path(spec));
    }
    candidates
}

fn downloaded_models_dir() -> PathBuf {
    if let Ok(path) = env::var(MODEL_DIR_ENV) {
        return PathBuf::from(path);
    }

    if cfg!(target_os = "windows") {
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| dirs_next::home_dir().map(|home| home.join("AppData").join("Local")))
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Microwest Whisper")
            .join("models")
    } else if cfg!(target_os = "macos") {
        dirs_next::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library")
            .join("Application Support")
            .join("Microwest Whisper")
            .join("models")
    } else {
        dirs_next::data_dir()
            .unwrap_or_else(|| {
                dirs_next::home_dir()
                    .map(|home| home.join(".local").join("share"))
                    .unwrap_or_else(|| PathBuf::from("."))
            })
            .join("microwest-whisper")
            .join("models")
    }
}

fn downloaded_model_path(spec: &ModelSpec) -> PathBuf {
    downloaded_models_dir().join(spec.filename)
}

fn partial_model_path(destination: &Path) -> PathBuf {
    destination.with_file_name(format!(
        "{}.part",
        destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("model.bin")
    ))
}

fn downloaded_models_size(models_dir: &Path) -> u64 {
    MODEL_SPECS
        .iter()
        .map(|spec| models_dir.join(spec.filename))
        .filter_map(|path| path.metadata().ok().map(|metadata| metadata.len()))
        .sum()
}

fn verify_model_file(path: &Path, spec: &ModelSpec) -> Result<bool, String> {
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    if metadata.len() != spec.size_bytes {
        return Ok(false);
    }

    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual_hash = hex::encode(hasher.finalize());
    Ok(actual_hash == spec.sha256)
}

fn emit_download_event(
    app: &AppHandle,
    kind: &str,
    spec: &ModelSpec,
    downloaded: u64,
    total: u64,
    line: &str,
    path: &Path,
) -> Result<(), String> {
    let progress = if total == 0 {
        0
    } else {
        ((downloaded.saturating_mul(100) / total).min(100)) as u8
    };
    app.emit(
        "model-download-event",
        ModelDownloadEvent {
            kind: kind.to_string(),
            model: spec.id.to_string(),
            downloaded_bytes: downloaded,
            total_bytes: total,
            progress,
            line: line.to_string(),
            path: path.to_string_lossy().to_string(),
        },
    )
    .map_err(|error| error.to_string())
}

fn format_bytes(value: u64) -> String {
    const MIB: f64 = 1024.0 * 1024.0;
    format!("{:.1} MiB", value as f64 / MIB)
}
