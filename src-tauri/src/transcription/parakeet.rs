use super::{
    clean_text, emit_event_to, ensure_not_cancelled, transcript_text, EventSink, NativeTranscript,
    TranscriptSegment, TranscriptionPaths, TranscriptionRequest, TranscriptionState,
};
use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig, OfflineRecognizerResult,
    OfflineTransducerModelConfig,
};
use std::path::Path;

pub(super) const BACKEND: &str = "sherpa-onnx";
const RATE: usize = 16_000;
const FRAME: usize = 320;

// Match the tested segmentation: cut at the centre of the quietest 240 ms
// between seconds 12 and 20. Keep up to 22 seconds together at end of file.
fn chunk_length(samples: &[f32]) -> usize {
    if samples.len() <= 22 * RATE {
        return samples.len();
    }
    let energies: Vec<f64> = samples[12 * RATE..20 * RATE + 12 * FRAME]
        .chunks_exact(FRAME)
        .map(|frame| frame.iter().map(|&x| f64::from(x).powi(2)).sum())
        .collect();
    let quietest = energies
        .windows(12)
        .take(8 * RATE / FRAME)
        .map(|frames| frames.iter().sum::<f64>())
        .enumerate()
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap()
        .0;
    12 * RATE + (quietest + 6) * FRAME
}

fn subtitles(
    result: &OfflineRecognizerResult,
    offset: f64,
    duration: f64,
) -> Vec<TranscriptSegment> {
    let full_text = clean_text(&result.text);
    if full_text.is_empty() {
        return Vec::new();
    }
    let fallback = || {
        vec![TranscriptSegment {
            start: offset,
            end: offset + duration,
            text: full_text.clone(),
        }]
    };
    let Some(times) = result.timestamps.as_deref() else {
        return fallback();
    };
    let pieces: Vec<String> = result
        .tokens
        .iter()
        .map(|token| token.replace('▁', " "))
        .collect();
    if times.len() != pieces.len()
        || times.is_empty()
        || clean_text(&pieces.concat()) != full_text
        || times
            .iter()
            .any(|t| !t.is_finite() || *t < 0.0 || f64::from(*t) >= duration)
        || times.windows(2).any(|t| t[1] < t[0])
    {
        return fallback();
    }
    let mut segments = Vec::new();
    let mut first = 0;
    for i in 1..=pieces.len() {
        let last = i == pieces.len();
        if !last
            && !(pieces[i].starts_with(char::is_whitespace)
                && times[i] > times[first]
                && (times[i] - times[first] >= 5.0
                    || times[i] - times[i - 1] >= 0.8
                    || pieces[i - 1].ends_with(['.', '!', '?'])))
        {
            continue;
        }
        let end_limit = if last { duration } else { f64::from(times[i]) };
        let tail = result
            .durations
            .as_ref()
            .and_then(|d| d.get(i - 1))
            .copied()
            .filter(|d| d.is_finite() && *d > 0.0)
            .unwrap_or(0.35);
        let end = f64::from(times[i - 1] + tail).min(end_limit);
        let text = clean_text(&pieces[first..i].concat());
        if !text.is_empty() {
            segments.push(TranscriptSegment {
                start: offset + f64::from(times[first]),
                end: offset + end,
                text,
            });
        }
        first = i;
    }
    segments
}

pub(super) fn transcribe(
    events: &EventSink,
    state: &TranscriptionState,
    paths: &TranscriptionPaths,
    request: &TranscriptionRequest,
    model: &Path,
) -> Result<NativeTranscript, String> {
    let started = std::time::Instant::now();
    let timeout = super::command_timeout();
    let mut wav = hound::WavReader::open(&paths.wav)
        .map_err(|e| format!("Lecture du WAV impossible : {e}"))?;
    let spec = wav.spec();
    if spec.sample_rate != RATE as u32
        || spec.channels != 1
        || spec.bits_per_sample != 16
        || spec.sample_format != hound::SampleFormat::Int
    {
        return Err("Le moteur attend un WAV mono PCM 16 bits à 16 kHz.".into());
    }
    let total = u64::from(wav.duration());
    emit_event_to(
        events,
        "log",
        "system",
        "Chargement de Parakeet Ultra…",
        "Chargement modèle",
        25,
    )?;
    let component = |name: &str| Some(model.join(name).to_string_lossy().into_owned());
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer = OfflineTransducerModelConfig {
        encoder: component("encoder.int8.onnx"),
        decoder: component("decoder.int8.onnx"),
        joiner: component("joiner.int8.onnx"),
    };
    config.model_config.tokens = component("tokens.txt");
    config.model_config.provider = Some("cpu".into());
    config.model_config.model_type = Some("nemo_transducer".into());
    config.model_config.num_threads = if request.threads == 0 {
        std::thread::available_parallelism().map_or(1, |n| n.get().min(4)) as i32
    } else {
        request.threads.min(64) as i32
    };
    let recognizer = OfflineRecognizer::create(&config)
        .ok_or("Impossible de charger Parakeet Ultra. Vérifiez les fichiers du modèle.")?;
    let mut input = wav.samples::<i16>();
    let mut buffer = Vec::with_capacity(22 * RATE + 1);
    let mut processed = 0_u64;
    let mut segments = Vec::new();
    while processed < total {
        ensure_not_cancelled(state)?;
        if started.elapsed() > timeout {
            return Err(format!("La transcription a dépassé le délai de {}.", super::format_duration_human(timeout)));
        }
        for sample in input.by_ref().take(22 * RATE + 1 - buffer.len()) {
            buffer.push(
                f32::from(sample.map_err(|e| format!("Lecture audio interrompue : {e}"))?)
                    / 32768.0,
            );
        }
        if buffer.is_empty() {
            return Err("Le fichier WAV est incomplet.".into());
        }
        let count = chunk_length(&buffer);
        // Preserve the original timeline even when skipping silent passages.
        let silent = request.trim_silence && buffer[..count].iter().all(|x| x.abs() < 0.000_1);
        if !silent {
            let stream = recognizer.create_stream();
            stream.accept_waveform(RATE as i32, &buffer[..count]);
            recognizer.decode(&stream);
            ensure_not_cancelled(state)?;
            let result = stream
                .get_result()
                .ok_or("Parakeet Ultra n’a pas pu décoder ce passage.")?;
            segments.extend(subtitles(
                &result,
                processed as f64 / RATE as f64,
                count as f64 / RATE as f64,
            ));
        }
        buffer.drain(..count);
        processed += count as u64;
        let progress = (35 + processed * 55 / total) as u8;
        emit_event_to(
            events,
            "log",
            "system",
            &format!(
                "{} s sur {} s transcrites",
                processed / RATE as u64,
                total / RATE as u64
            ),
            "Transcription",
            progress,
        )?;
    }
    if segments.is_empty() {
        return Err("Aucune parole reconnue dans ce fichier.".into());
    }
    Ok(NativeTranscript {
        backend: BACKEND.into(),
        model: super::model_assets::DEFAULT_MODEL.into(),
        language: "auto".into(),
        model_path: model.to_string_lossy().into_owned(),
        source_audio: paths.audio.to_string_lossy().into_owned(),
        preprocessed_wav: paths.wav.to_string_lossy().into_owned(),
        duration_seconds: Some(total as f64 / RATE as f64),
        text: transcript_text(&segments),
        segments,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subtitles_keep_original_time_after_a_cut_and_do_not_lose_text() {
        let mut result = OfflineRecognizerResult {
            text: "Bonjour. À demain !".into(),
            tokens: ["▁Bonjour", ".", "▁À", "▁demain", "▁!"]
                .map(String::from)
                .to_vec(),
            timestamps: Some(vec![0.25, 0.6, 2.0, 2.3, 2.5]),
            durations: None,
            lang: String::new(),
            lang_probs: Vec::new(),
        };
        let segments = subtitles(&result, 20.0, 4.0);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start, 20.25);
        assert_eq!(segments[1].start, 22.0);
        assert_eq!(segments[1].text, "À demain !");
        result.timestamps = None;
        let fallback = subtitles(&result, 20.0, 4.0);
        assert_eq!(fallback[0].text, result.text);
        assert_eq!(fallback[0].end, 24.0);
    }

    #[test]
    fn cuts_at_a_pause_and_keeps_the_final_chunk_whole() {
        let mut samples = vec![0.5; RATE * 28];
        samples[15 * RATE..15 * RATE + 12 * FRAME].fill(0.0);
        let cut = chunk_length(&samples);
        assert_eq!(cut, 15 * RATE + 6 * FRAME);
        assert_eq!(chunk_length(&samples[cut..]), samples.len() - cut);
    }
}
