import type { TranscriptionRequest } from "../types";

export type TranscriptionSettings = Omit<TranscriptionRequest, "audio_path" | "output_dir">;

export const parakeetModel = "parakeet-ultra-int8";
export const audioFilterOptions = ["loudnorm", "voice-clean", "none"] as const;

export const defaultTranscriptionSettings: TranscriptionSettings = {
  model: parakeetModel,
  language: "auto",
  audio_filter: "loudnorm",
  threads: 0,
  device: "cpu",
  trim_silence: false,
  force: false,
};

const LEGACY_SETTINGS_KEY = "microwest-whisper:transcription-settings:v1";
const SETTINGS_KEY = "microwest-whisper:transcription-settings:v2";
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
    const current = storage.getItem(SETTINGS_KEY);
    const value = JSON.parse(current ?? storage.getItem(LEGACY_SETTINGS_KEY) ?? "null") as unknown;
    if (!isRecord(value)) return defaultTranscriptionSettings;

    const threads = typeof value.threads === "number" && Number.isInteger(value.threads) && value.threads >= 0 && value.threads <= 64
      ? value.threads
      : defaultTranscriptionSettings.threads;

    return {
      model: parakeetModel,
      language: "auto",
      audio_filter: optionValue(value.audio_filter, audioFilterOptions, audioFilterOptions[0]),
      threads,
      device: "cpu",
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

export const parakeetLabel = "Parakeet Ultra · INT8";
export const audioFilterLabel = (value: string) => ({ loudnorm: "Normaliser le volume", "voice-clean": "Nettoyer la voix", none: "Aucun filtre" })[value] ?? value;
