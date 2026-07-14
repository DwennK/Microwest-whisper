import type { TranscriptionRequest } from "../types";

export type TranscriptionSettings = Omit<TranscriptionRequest, "audio_path" | "output_dir">;

export const modelOptions = ["large-v3-turbo-q8_0", "large-v3-turbo-q5_0"] as const;
export const languageOptions = ["auto", "fr", "en", "de", "it", "es", "pt", "nl", "pl", "uk", "ar", "zh", "ja", "ko"] as const;
export const audioFilterOptions = ["loudnorm", "voice-clean", "none"] as const;
export const deviceOptions = ["auto", "cpu"] as const;

export const defaultTranscriptionSettings: TranscriptionSettings = {
  model: "large-v3-turbo-q8_0",
  language: "fr",
  audio_filter: "loudnorm",
  threads: 0,
  device: "auto",
  trim_silence: false,
  force: false,
};

const SETTINGS_KEY = "microwest-whisper:transcription-settings:v1";
const OUTPUT_DIRECTORY_KEY = "microwest-whisper:output-directory:v1";

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

function browserStorage(): Storage | null {
  try {
    const isTestDom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom");
    return typeof window === "undefined" || isTestDom ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionValue<const T extends readonly string[]>(value: unknown, options: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value as T[number] : fallback;
}

export function loadTranscriptionSettings(storage: StorageReader | null = browserStorage()): TranscriptionSettings {
  if (!storage) return defaultTranscriptionSettings;

  try {
    const value = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "null") as unknown;
    if (!isRecord(value)) return defaultTranscriptionSettings;

    const threads = typeof value.threads === "number" && Number.isInteger(value.threads) && value.threads >= 0 && value.threads <= 64
      ? value.threads
      : defaultTranscriptionSettings.threads;

    return {
      model: optionValue(value.model, modelOptions, modelOptions[0]),
      language: optionValue(value.language, languageOptions, languageOptions[1]),
      audio_filter: optionValue(value.audio_filter, audioFilterOptions, audioFilterOptions[0]),
      threads,
      device: optionValue(value.device, deviceOptions, deviceOptions[0]),
      trim_silence: typeof value.trim_silence === "boolean" ? value.trim_silence : defaultTranscriptionSettings.trim_silence,
      force: typeof value.force === "boolean" ? value.force : defaultTranscriptionSettings.force,
    };
  } catch {
    return defaultTranscriptionSettings;
  }
}

export function saveTranscriptionSettings(settings: TranscriptionSettings, storage: StorageWriter | null = browserStorage()) {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Preference persistence must never block transcription.
  }
}

export function loadOutputDirectory(storage: StorageReader | null = browserStorage()): string {
  if (!storage) return "";
  try {
    return storage.getItem(OUTPUT_DIRECTORY_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveOutputDirectory(outputDirectory: string, storage: StorageWriter | null = browserStorage()) {
  if (!storage || !outputDirectory.trim()) return;
  try {
    storage.setItem(OUTPUT_DIRECTORY_KEY, outputDirectory.trim());
  } catch {
    // Preference persistence must never block transcription.
  }
}

export const preferenceStorageKeys = {
  settings: SETTINGS_KEY,
  outputDirectory: OUTPUT_DIRECTORY_KEY,
} as const;
