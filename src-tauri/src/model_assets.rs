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

pub const DEFAULT_MODEL: &str = "parakeet-ultra-int8";
const ULTRA_BASE_URL: &str = "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-ultra-int8/resolve/402e1190ce85b9793118ee223db21fb0d12f52db";

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
    files: &'static [ModelFile],
}

#[derive(Clone, Copy)]
struct ModelFile {
    name: &'static str,
    bytes: u64,
    sha256: &'static str,
}

const PARAKEET: ModelSpec = ModelSpec {
    id: DEFAULT_MODEL,
    label: "Parakeet Ultra · INT8",
    filename: DEFAULT_MODEL,
    size_bytes: 670_576_835,
    size_label: "640 Mio",
    files: &[
        ModelFile {
            name: "encoder.int8.onnx",
            bytes: 652_282_345,
            sha256: "b43072e1b721f18a3df03fcfeb763ff7c4debdf29843598a3aba2f703e2780a3",
        },
        ModelFile {
            name: "decoder.int8.onnx",
            bytes: 11_845_274,
            sha256: "1fab98fe6c12aded87d2da66272cc9e148d0a0044ce3850a12fe56302ec4a922",
        },
        ModelFile {
            name: "joiner.int8.onnx",
            bytes: 6_355_277,
            sha256: "8a71aaccfdba3d451775507a889afd2257d2e754463fd81095a8c8f290f924c2",
        },
        ModelFile {
            name: "tokens.txt",
            bytes: 93_939,
            sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d",
        },
    ],
};

const MODEL_SPECS: &[ModelSpec] = &[
    PARAKEET,
    ModelSpec {
        id: "large-v3-turbo-q8_0",
        label: "large-v3-turbo q8_0",
        filename: "ggml-large-v3-turbo-q8_0.bin",
        size_bytes: 874_188_075,
        size_label: "834 MiB",
        files: &[ModelFile {
            name: "ggml-large-v3-turbo-q8_0.bin",
            bytes: 874_188_075,
            sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1",
        }],
    },
    ModelSpec {
        id: "large-v3-turbo-q5_0",
        label: "large-v3-turbo q5_0",
        filename: "ggml-large-v3-turbo-q5_0.bin",
        size_bytes: 574_041_195,
        size_label: "547 MiB",
        files: &[ModelFile {
            name: "ggml-large-v3-turbo-q5_0.bin",
            bytes: 574_041_195,
            sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        }],
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
                url: format!("{}/{}", base_url(spec), spec.files[0].name),
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
    install_model(
        &downloaded_models_dir(),
        model,
        |kind, spec, downloaded, line, path| {
            emit_download_event(app, kind, spec, downloaded, spec.size_bytes, line, path)
        },
    )
    .await?;
    Ok(model_status(engine_root))
}

fn model_lock(dir: &Path) -> Result<File, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let lock = File::options()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(".install.lock"))
        .map_err(|e| e.to_string())?;
    lock.try_lock()
        .map_err(|_| "Une autre opération sur les modèles est en cours.".to_string())?;
    Ok(lock)
}

async fn install_model(
    dir: &Path,
    model: &str,
    progress: impl Fn(&str, &ModelSpec, u64, &str, &Path) -> Result<(), String>,
) -> Result<(), String> {
    let spec = model_spec(model).ok_or_else(|| format!("Modèle inconnu : {model}"))?;
    let _lock = model_lock(dir)?;
    let destination = dir.join(spec.filename);
    let directory = if spec.id == DEFAULT_MODEL {
        destination.as_path()
    } else {
        dir
    };
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    progress(
        "started",
        spec,
        0,
        "Préparation du téléchargement…",
        &destination,
    )?;
    let client = reqwest::Client::new();
    let mut downloaded = 0;
    for asset in spec.files {
        let path = directory.join(asset.name);
        if path.is_file() && verify_model_file(&path, asset)? {
            downloaded += asset.bytes;
            continue;
        }
        let response = client
            .get(format!("{}/{}", base_url(spec), asset.name))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut partial = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
        let mut digest = Sha256::new();
        let mut received = 0;
        let mut last_emit = Instant::now();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            if received > asset.bytes {
                return Err(format!("Taille inattendue pour {}.", asset.name));
            }
            partial.write_all(&chunk).map_err(|e| e.to_string())?;
            digest.update(&chunk);
            if last_emit.elapsed() >= Duration::from_millis(250) {
                let total = downloaded + received;
                progress(
                    "progress",
                    spec,
                    total,
                    &format!("{} / {}", format_bytes(total), spec.size_label),
                    &destination,
                )?;
                last_emit = Instant::now();
            }
        }
        if received != asset.bytes || hex::encode(digest.finalize()) != asset.sha256 {
            return Err(format!(
                "Le fichier {} est incomplet ou endommagé. Relancez le téléchargement.",
                asset.name
            ));
        }
        partial.persist(&path).map_err(|e| e.to_string())?;
        downloaded += received;
    }
    progress(
        "completed",
        spec,
        downloaded,
        "Le modèle est prêt.",
        &destination,
    )
}

fn base_url(spec: &ModelSpec) -> &'static str {
    if spec.id == DEFAULT_MODEL {
        ULTRA_BASE_URL
    } else {
        HF_BASE_URL
    }
}

pub fn delete_downloaded_models(engine_root: &Path) -> Result<ModelInventory, String> {
    let dir = downloaded_models_dir();
    let _lock = model_lock(&dir)?;
    for spec in MODEL_SPECS {
        for path in installed_files(&dir, spec) {
            if path.is_file() {
                fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
        }
    }
    let _ = fs::remove_dir(dir.join(DEFAULT_MODEL));
    Ok(model_status(engine_root))
}

fn installed_files(dir: &Path, spec: &ModelSpec) -> Vec<PathBuf> {
    let dir = if spec.id == DEFAULT_MODEL {
        dir.join(spec.filename)
    } else {
        dir.to_owned()
    };
    spec.files.iter().map(|file| dir.join(file.name)).collect()
}

fn ultra_ready(path: &Path) -> bool {
    PARAKEET.files.iter().all(|file| {
        path.join(file.name)
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() == file.bytes)
    })
}

pub fn resolve_model_path(engine_root: &Path, requested: &str) -> ResolvedModelPath {
    if is_parakeet(requested) {
        let bundled = engine_root.join("models").join(DEFAULT_MODEL);
        if ultra_ready(&bundled) {
            return ResolvedModelPath {
                path: bundled,
                exists: true,
            };
        }
        let path = downloaded_models_dir().join(DEFAULT_MODEL);
        return ResolvedModelPath {
            exists: ultra_ready(&path),
            path,
        };
    }
    if let Ok(path) = env::var(MODEL_ENV) {
        let path = PathBuf::from(path);
        return ResolvedModelPath {
            exists: path.exists(),
            path,
        };
    }

    let model_name = requested.trim();
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

pub fn is_parakeet(requested: &str) -> bool {
    matches!(requested.trim(), "" | "auto" | DEFAULT_MODEL)
}

fn model_spec(model: &str) -> Option<&'static ModelSpec> {
    MODEL_SPECS
        .iter()
        .find(|spec| spec.id == model || spec.filename == model)
}

fn model_source(engine_root: &Path, spec: &ModelSpec) -> String {
    if spec.id == DEFAULT_MODEL {
        if ultra_ready(&engine_root.join("models").join(DEFAULT_MODEL)) {
            return "bundled".into();
        }
        if ultra_ready(&downloaded_model_path(spec)) {
            return "downloaded".into();
        }
        return "missing".into();
    }
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

fn downloaded_models_size(models_dir: &Path) -> u64 {
    MODEL_SPECS
        .iter()
        .flat_map(|spec| installed_files(models_dir, spec))
        .filter_map(|path| path.metadata().ok().map(|metadata| metadata.len()))
        .sum()
}

fn verify_model_file(path: &Path, spec: &ModelFile) -> Result<bool, String> {
    let metadata = path.metadata().map_err(|error| error.to_string())?;
    if metadata.len() != spec.bytes {
        return Ok(false);
    }

    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "downloads and verifies the pinned model in the configured model directory"]
    fn install_parakeet_for_local_run() {
        tauri::async_runtime::block_on(install_model(
            &downloaded_models_dir(),
            DEFAULT_MODEL,
            |_, _, _, _, _| Ok(()),
        ))
        .unwrap();
        assert!(ultra_ready(&downloaded_models_dir().join(DEFAULT_MODEL)));
    }
}
