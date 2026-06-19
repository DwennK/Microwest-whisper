mod license;
mod paths;
mod transcription;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(transcription::TranscriptionState::default())
        .invoke_handler(tauri::generate_handler![
            license::read_license_state,
            license::activate_license,
            license::validate_license,
            transcription::engine_status,
            transcription::expected_outputs,
            transcription::read_history,
            transcription::read_text_preview,
            transcription::start_transcription,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Microwest Whisper");
}
