export interface LicenseSnapshot {
  state: Record<string, unknown>;
  status_text: string;
  cached_valid: boolean;
}

export interface LicenseCheck {
  ok: boolean;
  message: string;
  state: Record<string, unknown>;
  online: boolean;
}

export interface EngineStatus {
  engine_root: string;
  python: string;
  transcribe_path: string;
  default_output_dir: string;
  default_work_dir: string;
  can_run: boolean;
  message: string;
}

export interface OutputFile {
  label: string;
  path: string;
  exists: boolean;
}

export interface HistoryRecord {
  created_at: string;
  status: string;
  source_audio: string;
  stem: string;
  duration_seconds: number | null;
  language: string;
  model: string;
  diarization: boolean;
  outputs: string[];
}

export interface TranscriptionEvent {
  kind: "started" | "log" | "completed" | "failed";
  stream: string;
  line: string;
  stage: string;
  progress: number;
}

export interface TranscriptionRequest {
  audio_path: string;
  output_dir: string;
  work_dir?: string;
  model: string;
  asr_backend: string;
  language: string;
  audio_filter: string;
  batch_size: number;
  threads: number;
  device: string;
  compute_type: string;
  diarization: boolean;
  speaker_mode: "auto" | "exact" | "range";
  speakers?: number;
  min_speakers?: number;
  max_speakers?: number;
  trim_silence: boolean;
  force: boolean;
  speaker_map?: string;
  hf_token?: string;
}
