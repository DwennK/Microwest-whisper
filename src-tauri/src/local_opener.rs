use std::{
    fs,
    path::{Path, PathBuf},
};

// Export destinations are chosen at runtime, so a static opener scope cannot
// enumerate them. Validate the target natively before using the OS association.
fn validated_path(path: &str, output_dir: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Aucun fichier ou dossier sélectionné.".into());
    }
    let target =
        fs::canonicalize(path).map_err(|error| format!("Chemin inaccessible : {error}"))?;
    if target.is_dir() {
        return Ok(target);
    }
    let suffixes = [
        ".segments.srt",
        ".clean.txt",
        ".transcript.docx",
        ".selection.srt",
        ".selection.txt",
        ".selection.docx",
    ];
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if !target.is_file() || !suffixes.iter().any(|suffix| name.ends_with(suffix)) {
        return Err("Seuls les exports SRT, texte et Word peuvent être ouverts.".into());
    }
    let directory = fs::canonicalize(Path::new(output_dir))
        .map_err(|error| format!("Dossier de sortie inaccessible : {error}"))?;
    if target.parent() != Some(directory.as_path()) {
        return Err("Ce fichier ne se trouve pas dans le dossier de sortie sélectionné.".into());
    }
    Ok(target)
}

#[tauri::command]
pub async fn open_local_path(path: String, output_dir: String) -> Result<(), String> {
    let target = validated_path(&path, &output_dir)?;
    tauri_plugin_opener::open_path(target, None::<&str>).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_exports_and_folders_in_custom_locations_but_rejects_other_files() {
        let root = std::env::temp_dir().join(format!("microwest-opener-{}", uuid::Uuid::new_v4()));
        let output = root.join("Dossier personnalisé avec espaces");
        fs::create_dir_all(&output).unwrap();
        for suffix in [
            "segments.srt",
            "clean.txt",
            "transcript.docx",
            "selection.srt",
            "selection.txt",
            "selection.docx",
        ] {
            let file = output.join(format!("réunion.{suffix}"));
            fs::write(&file, b"test").unwrap();
            assert_eq!(
                validated_path(file.to_str().unwrap(), output.to_str().unwrap()).unwrap(),
                fs::canonicalize(&file).unwrap()
            );
        }
        assert!(validated_path(output.to_str().unwrap(), "").is_ok());
        for name in [
            "program.exe",
            "script.cmd",
            "notes.txt",
            "fake.clean.txt.exe",
        ] {
            let file = output.join(name);
            fs::write(&file, b"test").unwrap();
            assert!(validated_path(file.to_str().unwrap(), output.to_str().unwrap()).is_err());
        }
        let outside = root.join("outside.clean.txt");
        fs::write(&outside, b"test").unwrap();
        assert!(validated_path(outside.to_str().unwrap(), output.to_str().unwrap()).is_err());
        assert!(validated_path(
            output.join("missing.clean.txt").to_str().unwrap(),
            output.to_str().unwrap()
        )
        .is_err());
        assert!(validated_path("", output.to_str().unwrap()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
