import { describe, expect, it, vi } from "vitest";
import {
  defaultTranscriptionSettings,
  loadOutputDirectory,
  loadTranscriptionSettings,
  preferenceStorageKeys,
  saveOutputDirectory,
  saveTranscriptionSettings,
} from "./preferences";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  };
}

describe("preferences", () => {
  it("loads persisted transcription settings and rejects unsupported values", () => {
    const storage = memoryStorage({
      [preferenceStorageKeys.settings]: JSON.stringify({
        model: "large-v3-turbo-q5_0",
        language: "de",
        audio_filter: "invalid",
        threads: 12,
        device: "cpu",
        trim_silence: true,
        force: true,
      }),
    });

    expect(loadTranscriptionSettings(storage)).toEqual({
      model: "large-v3-turbo-q5_0",
      language: "de",
      audio_filter: defaultTranscriptionSettings.audio_filter,
      threads: 12,
      device: "cpu",
      trim_silence: true,
      force: true,
    });
  });

  it("falls back safely when persisted settings are malformed", () => {
    const storage = memoryStorage({ [preferenceStorageKeys.settings]: "not-json" });
    expect(loadTranscriptionSettings(storage)).toEqual(defaultTranscriptionSettings);
  });

  it("saves settings and the selected output directory", () => {
    const storage = memoryStorage();
    saveTranscriptionSettings(defaultTranscriptionSettings, storage);
    saveOutputDirectory(" /tmp/transcriptions ", storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      preferenceStorageKeys.settings,
      JSON.stringify(defaultTranscriptionSettings),
    );
    expect(loadOutputDirectory(storage)).toBe("/tmp/transcriptions");
  });
});
