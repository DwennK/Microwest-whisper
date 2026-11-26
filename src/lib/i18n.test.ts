import { describe, expect, it, vi } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import english from "../locales/en.json";
import { interfaceLanguages, loadInterfaceLanguage, message, resolveLanguage, t } from "./i18n";

describe("interface languages", () => {
  it("uses the first supported system language, including regional variants", () => {
    expect(resolveLanguage("auto", ["ja-JP", "de-CH", "fr-CH"])).toBe("de");
    expect(resolveLanguage("auto", ["pt_BR"])).toBe("pt");
    expect(resolveLanguage("auto", ["ja-JP"])).toBe("en");
    expect(resolveLanguage("uk", ["de-CH"])).toBe("uk");
  });

  it("loads a saved manual choice before the first render on the next launch", async () => {
    const key = "microwest-whisper:interface-language";
    localStorage.setItem(key, "it");
    try {
      vi.resetModules();
      const fresh = await import("./i18n");
      await fresh.loadInterfaceLanguage();
      expect(document.documentElement.lang).toBe("it");
      expect(fresh.t("Réglages")).toBe("Impostazioni");
    } finally {
      localStorage.removeItem(key);
      await loadInterfaceLanguage();
    }
  });

  it("prefers the desktop language list over WebView defaults in automatic mode", async () => {
    mockIPC(command => command === "system_languages" ? ["ja", "en-GB"] : undefined);
    try {
      await loadInterfaceLanguage();
      expect(t("Réglages")).toBe("Settings");
    } finally {
      clearMocks();
      await loadInterfaceLanguage();
    }
  });

  it("ships a complete catalog for every language with intact placeholders", () => {
    const catalogs = import.meta.glob<Record<string, string>>("../locales/*.json", { eager: true, import: "default" });
    expect(interfaceLanguages).toHaveLength(25);
    const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort();
    for (const language of interfaceLanguages.filter(code => code !== "fr")) {
      const catalog = catalogs[`../locales/${language}.json`];
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(english).sort());
      const invalid = Object.entries(catalog).filter(([key, translation]) =>
        !translation.trim() || placeholders(key).join() !== placeholders(translation).join());
      expect(invalid, language).toEqual([]);
    }
  });

  it("translates native status messages and keeps file names and unknown errors intact", async () => {
    const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
    try {
      await loadInterfaceLanguage();
      expect(t("Réglages")).toBe("Settings");
      expect(message("Fichier audio introuvable: /audio/Réglages.wav")).toBe("Audio file not found: /audio/Réglages.wav");
      expect(message("Chargement des résultats impossible: Fichier audio introuvable: /audio/Réglages.wav"))
        .toBe("Could not load results: Audio file not found: /audio/Réglages.wav");
      expect(message("OS error 32")).toBe("OS error 32");
    } finally {
      languages.mockRestore();
      await loadInterfaceLanguage();
    }
  });
});
