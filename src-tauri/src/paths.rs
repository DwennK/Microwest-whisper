use serde::Serialize;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};

const OUTPUT_SUFFIXES: &[(&str, &str)] = &[
    (".transcript.txt", "TXT"),
    (".transcript.md", "Markdown"),
    (".clean.txt", "Texte propre"),
    (".segments.srt", "SRT"),
    (".segments.json", "Segments JSON"),
    (".transcript.docx", "DOCX"),
    (".whispercpp.json", "whisper.cpp JSON"),
];

#[derive(Debug, Serialize)]
pub struct OutputFile {
    pub label: String,
    pub path: String,
    pub exists: bool,
}

pub fn default_output_dir(engine_root: &Path) -> PathBuf {
    engine_root.join("output-v2")
}

pub fn default_work_dir(engine_root: &Path) -> PathBuf {
    engine_root.join("work-v2")
}

pub fn expected_output_paths(audio: &Path, output_dir: &Path) -> Vec<OutputFile> {
    let stem = transcript_stem(audio);
    OUTPUT_SUFFIXES
        .iter()
        .map(|(suffix, label)| {
            let path = output_dir.join(format!("{stem}{suffix}"));
            OutputFile {
                label: (*label).to_string(),
                exists: path.exists(),
                path: path.to_string_lossy().to_string(),
            }
        })
        .collect()
}

pub fn work_wav_path(audio: &Path, work_dir: &Path) -> PathBuf {
    work_dir.join(format!("{}.16k-mono.wav", transcript_stem(audio)))
}

pub fn transcript_output_stem(audio: &Path) -> String {
    transcript_stem(audio)
}

fn transcript_stem(audio: &Path) -> String {
    let stem = audio
        .file_stem()
        .and_then(|value| value.to_str())
        .map(slugify)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "audio".to_string());
    format!("{}-{}", stem, source_id(audio))
}

fn slugify(value: &str) -> String {
    let mut output = String::new();
    let mut previous_was_separator = false;
    for character in value.chars() {
        let allowed = character.is_alphanumeric() || matches!(character, '_' | '.' | '-');
        if allowed {
            output.push(character);
            previous_was_separator = false;
        } else if !previous_was_separator {
            output.push('_');
            previous_was_separator = true;
        }
    }
    output.trim_matches(['_', '.']).to_string()
}

fn source_id(audio: &Path) -> String {
    let resolved = audio
        .canonicalize()
        .unwrap_or_else(|_| audio.to_path_buf())
        .to_string_lossy()
        .to_string();
    let digest = Sha1::digest(resolved.as_bytes());
    hex::encode(digest)[..8].to_string()
}
