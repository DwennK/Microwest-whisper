use crate::paths;
use chrono::{SecondsFormat, Utc};
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use super::{transcript_text, NativeTranscript, TranscriptSegment};

pub(super) fn write_outputs(
    audio: &Path,
    output_dir: &Path,
    transcript: &NativeTranscript,
) -> Result<Vec<PathBuf>, String> {
    let stem = paths::transcript_output_stem(audio);
    let txt = output_dir.join(format!("{stem}.transcript.txt"));
    let md = output_dir.join(format!("{stem}.transcript.md"));
    let clean_txt = output_dir.join(format!("{stem}.clean.txt"));
    let srt = output_dir.join(format!("{stem}.segments.srt"));
    let segments_json = output_dir.join(format!("{stem}.segments.json"));
    let docx = output_dir.join(format!("{stem}.transcript.docx"));
    let raw_json = output_dir.join(format!("{stem}.whispercpp.json"));

    write_timestamped_txt(&txt, &transcript.segments)?;
    write_markdown(&md, transcript, audio)?;
    write_clean_txt(&clean_txt, transcript)?;
    write_srt(&srt, &transcript.segments)?;
    write_segments_json(&segments_json, transcript)?;
    write_docx(&docx, transcript, audio)?;
    fs::write(
        &raw_json,
        serde_json::to_string_pretty(transcript).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let outputs = vec![txt, md, clean_txt, srt, segments_json, docx, raw_json];
    println_outputs(&outputs);
    Ok(outputs)
}

pub(super) fn write_selection_outputs(
    audio: &Path,
    output_dir: &Path,
    segments: Vec<TranscriptSegment>,
    requested_formats: &[String],
    backend_name: &str,
) -> Result<Vec<paths::OutputFile>, String> {
    let stem = paths::transcript_output_stem(audio);
    let transcript = NativeTranscript {
        backend: backend_name.to_string(),
        model: "selection".to_string(),
        model_path: String::new(),
        language: String::new(),
        source_audio: audio.to_string_lossy().to_string(),
        preprocessed_wav: String::new(),
        duration_seconds: segments.last().map(|segment| segment.end),
        text: transcript_text(&segments),
        segments,
    };

    let formats = if requested_formats.is_empty() {
        vec![
            "markdown".to_string(),
            "txt".to_string(),
            "srt".to_string(),
            "json".to_string(),
            "docx".to_string(),
        ]
    } else {
        requested_formats
            .iter()
            .map(|format| format.trim().to_ascii_lowercase())
            .collect()
    };

    let mut outputs = Vec::new();
    for format in formats {
        match format.as_str() {
            "markdown" | "md" => {
                let path = output_dir.join(format!("{stem}.selection.md"));
                write_markdown(&path, &transcript, audio)?;
                outputs.push(output_file("Sélection Markdown", &path));
            }
            "txt" | "text" => {
                let path = output_dir.join(format!("{stem}.selection.txt"));
                write_clean_txt(&path, &transcript)?;
                outputs.push(output_file("Sélection TXT", &path));
            }
            "srt" => {
                let path = output_dir.join(format!("{stem}.selection.srt"));
                write_srt(&path, &transcript.segments)?;
                outputs.push(output_file("Sélection SRT", &path));
            }
            "json" => {
                let path = output_dir.join(format!("{stem}.selection.json"));
                write_segments_json(&path, &transcript)?;
                outputs.push(output_file("Sélection JSON", &path));
            }
            "docx" => {
                let path = output_dir.join(format!("{stem}.selection.docx"));
                write_docx(&path, &transcript, audio)?;
                outputs.push(output_file("Sélection DOCX", &path));
            }
            _ => {}
        }
    }

    if outputs.is_empty() {
        return Err("Aucun format d'export sélectionné valide.".to_string());
    }

    Ok(outputs)
}

pub(super) fn output_file(label: &str, path: &Path) -> paths::OutputFile {
    paths::OutputFile {
        label: label.to_string(),
        path: path.to_string_lossy().to_string(),
        exists: path.exists(),
    }
}

pub(super) fn refreshed_transcript(
    mut transcript: NativeTranscript,
    segments: Vec<TranscriptSegment>,
) -> NativeTranscript {
    transcript.duration_seconds = segments.last().map(|segment| segment.end);
    transcript.text = transcript_text(&segments);
    transcript.segments = segments;
    transcript
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

pub(super) fn document_xml(transcript: &NativeTranscript, source: &Path) -> String {
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

fn format_ts(seconds: f64, sep: &str) -> String {
    let milliseconds = (seconds.max(0.0) * 1000.0).round() as u64;
    let hours = milliseconds / 3_600_000;
    let minutes = (milliseconds % 3_600_000) / 60_000;
    let secs = (milliseconds % 60_000) / 1000;
    let millis = milliseconds % 1000;
    format!("{hours:02}:{minutes:02}:{secs:02}{sep}{millis:03}")
}

fn println_outputs(outputs: &[PathBuf]) {
    println!();
    println!("Done. Files written:");
    for path in outputs {
        println!("- {}", path.to_string_lossy());
    }
}
