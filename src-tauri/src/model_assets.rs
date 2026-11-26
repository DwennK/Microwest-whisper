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
    size_label: "640 MiB",
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

// Clear only files installed by older releases, and only on explicit removal.
const LEGACY_FILES: &[&str] = &[
    "ggml-large-v3-turbo-q8_0.bin",
    "ggml-large-v3-turbo-q5_0.bin",
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
    let spec = &PARAKEET;
    let resolved = resolve_model_path(engine_root);
    let source = if !resolved.exists {
        "missing"
    } else if resolved.path.starts_with(&models_dir) {
        "downloaded"
    } else {
        "bundled"
    };
    let model = ModelInfo {
        id: spec.id.into(),
        label: spec.label.into(),
        filename: spec.filename.into(),
        url: format!("{}/{}", ULTRA_BASE_URL, spec.files[0].name),
        size_bytes: spec.size_bytes,
        size_label: spec.size_label.into(),
        installed: resolved.exists,
        source: source.into(),
        path: resolved.path.to_string_lossy().into_owned(),
    };

    ModelInventory {
        models_dir: models_dir.to_string_lossy().to_string(),
        total_downloaded_bytes: downloaded_models_size(&models_dir),
        models: vec![model],
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
    if model != DEFAULT_MODEL {
        return Err(format!("Modèle inconnu : {model}"));
    }
    let spec = &PARAKEET;
    let _lock = model_lock(dir)?;
    let destination = dir.join(spec.filename);
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
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
        let path = destination.join(asset.name);
        if path.is_file() && verify_model_file(&path, asset)? {
            downloaded += asset.bytes;
            continue;
        }
        let response = client
            .get(format!("{}/{}", ULTRA_BASE_URL, asset.name))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut partial =
            tempfile::NamedTempFile::new_in(&destination).map_err(|e| e.to_string())?;
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

pub fn delete_downloaded_models(engine_root: &Path) -> Result<ModelInventory, String> {
    let dir = downloaded_models_dir();
    let _lock = model_lock(&dir)?;
    for path in installed_files(&dir) {
        if path.is_file() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    let _ = fs::remove_dir(dir.join(DEFAULT_MODEL));
    Ok(model_status(engine_root))
}

fn installed_files(dir: &Path) -> impl Iterator<Item = PathBuf> + '_ {
    PARAKEET
        .files
        .iter()
        .map(|file| dir.join(DEFAULT_MODEL).join(file.name))
        .chain(LEGACY_FILES.iter().map(|name| dir.join(name)))
}

fn ultra_ready(path: &Path) -> bool {
    PARAKEET.files.iter().all(|file| {
        path.join(file.name)
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() == file.bytes)
    })
}

pub fn resolve_model_path(engine_root: &Path) -> ResolvedModelPath {
    let bundled = engine_root.join("models").join(DEFAULT_MODEL);
    if ultra_ready(&bundled) {
        return ResolvedModelPath {
            path: bundled,
            exists: true,
        };
    }
    let path = downloaded_models_dir().join(DEFAULT_MODEL);
    ResolvedModelPath {
        exists: ultra_ready(&path),
        path,
    }
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

fn downloaded_models_size(models_dir: &Path) -> u64 {
    installed_files(models_dir)
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
    fn rejects_retired_models_before_creating_download_files() {
        let dir = tempfile::tempdir().unwrap();
        for model in ["large-v3-turbo-q8_0", "large-v3-turbo-q5_0"] {
            let result = tauri::async_runtime::block_on(install_model(
                dir.path(),
                model,
                |_, _, _, _, _| Ok(()),
            ));
            assert!(result.unwrap_err().contains("Modèle inconnu"));
        }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        let inventory = model_status(dir.path());
        assert_eq!(inventory.models.len(), 1);
        assert_eq!(inventory.models[0].id, DEFAULT_MODEL);
    }

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
