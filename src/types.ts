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
  backend: string;
  engine_root: string;
  whisper_cli: string;
  ffmpeg: string;
  model_path: string;
  default_model: string;
  default_output_dir: string;
  default_work_dir: string;
  platform: string;
  architecture: string;
  can_run: boolean;
  message: string;
}

export interface AppDiagnostics {
  name: string;
  version: string;
  backend: string;
  platform: string;
  architecture: string;
  engine_root: string;
  default_output_dir: string;
  default_work_dir: string;
  model_dir: string;
  license_state_path: string;
  update_endpoint: string;
}

export interface OutputFile {
  label: string;
  path: string;
  exists: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  filename: string;
  url: string;
  size_bytes: number;
  size_label: string;
  installed: boolean;
  path: string;
  source: "env" | "bundled" | "downloaded" | "missing" | string;
}

export interface ModelInventory {
  models_dir: string;
  total_downloaded_bytes: number;
  models: ModelInfo[];
}

export interface ModelDownloadEvent {
  kind: "started" | "progress" | "completed";
  model: string;
  downloaded_bytes: number;
  total_bytes: number;
  progress: number;
  line: string;
  path: string;
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
  kind: "started" | "log" | "completed" | "failed" | "cancelled";
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
  language: string;
  audio_filter: string;
  threads: number;
  device: string;
  trim_silence: boolean;
  force: boolean;
}
