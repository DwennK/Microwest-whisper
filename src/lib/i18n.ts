import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import english from "../locales/en.json";

const names = {
  bg: "Български", hr: "Hrvatski", cs: "Čeština", da: "Dansk", nl: "Nederlands",
  en: "English", et: "Eesti", fi: "Suomi", fr: "Français", de: "Deutsch",
  el: "Ελληνικά", hu: "Magyar", it: "Italiano", lv: "Latviešu", lt: "Lietuvių",
  mt: "Malti", pl: "Polski", pt: "Português", ro: "Română", ru: "Русский",
  sk: "Slovenčina", sl: "Slovenščina", es: "Español", sv: "Svenska", uk: "Українська",
};
type Language = keyof typeof names;
export const interfaceLanguages = (Object.keys(names) as Language[])
  .sort((left, right) => names[left].localeCompare(names[right], "en"));
type Catalog = Record<string, string>;
const supported = new Set<string>(interfaceLanguages);
const storageKey = "microwest-whisper:interface-language";
const changeEvent = "microwest-interface-language";
const loaders = import.meta.glob<Catalog>(["../locales/*.json", "!../locales/en.json"], { import: "default" });
const catalogs = new Map<string, Catalog>([["en", english]]);
let selected = readPreference();
let language: Language = "fr";

function readPreference() {
  try {
    const stored = localStorage.getItem(storageKey) ?? "auto";
    return supported.has(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function resolveLanguage(choice: string, languages: readonly string[]): Language {
  if (supported.has(choice)) return choice as Language;
  for (const tag of languages) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (supported.has(base)) return base as Language;
  }
  return "en";
}

let latestRequest = 0;

async function requestedLanguage(): Promise<Language> {
  if (selected !== "auto") return selected as Language;
  const webLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const system = await invoke<string[]>("system_languages");
      if (system?.length) return resolveLanguage("auto", system);
    } catch { /* Use the WebView preferences when native preferences are unavailable. */ }
  }
  return resolveLanguage("auto", webLanguages);
}

export function currentLanguage() {
  return language;
}

export async function loadInterfaceLanguage() {
  const request = ++latestRequest;
  const requested = await requestedLanguage();
  let next = requested;
  if (requested !== "fr" && !catalogs.has(requested)) {
    try {
      catalogs.set(requested, await loaders[`../locales/${requested}.json`]());
    } catch {
      next = "en";
    }
  }
  if (request !== latestRequest) return;
  language = next;
  document.documentElement.lang = next;
  window.dispatchEvent(new Event(changeEvent));
}

export function languageName(code: string) {
  return supported.has(code) ? names[code as Language] : code;
}

function setPreference(next: string) {
  if (next !== "auto" && !supported.has(next)) return;
  selected = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the choice for this session. */ }
  void loadInterfaceLanguage();
}

function subscribe(notify: () => void) {
  window.addEventListener(changeEvent, notify);
  return () => window.removeEventListener(changeEvent, notify);
}

function snapshot() {
  return selected + ":" + language;
}

export function useInterfaceLanguage() {
  useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    function syncStoredChoice(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      selected = readPreference();
      void loadInterfaceLanguage();
    }
    window.addEventListener("languagechange", loadInterfaceLanguage);
    window.addEventListener("storage", syncStoredChoice);
    void loadInterfaceLanguage();
    return () => {
      window.removeEventListener("languagechange", loadInterfaceLanguage);
      window.removeEventListener("storage", syncStoredChoice);
    };
  }, []);
  return { preference: selected, setPreference };
}

export function t(source: string, ...values: (string | number)[]): string {
  const catalog = catalogs.get(language);
  const translated = catalog && Object.hasOwn(catalog, source) ? catalog[source] : source;
  return values.length ? translated.replace(/\{(\d+)\}/g, (token, index) => String(values[Number(index)] ?? token)) : translated;
}

// Match only known application messages. Interpolated file paths and OS errors
// are preserved as supplied by the native command.
const patterns = Object.keys(english)
  .filter(key => key.includes("{0}"))
  .sort((left, right) => right.length - left.length)
  .map(key => {
    const parts = key.split(/\{\d+\}/);
    const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { key, pattern: new RegExp("^" + parts.map(escape).join("([\\s\\S]+?)") + "$") };
  });

// These messages wrap a second application error. Other arguments can be user
// data (such as a filename) and must stay verbatim.
const wrappedErrors = new Set([
  "Affichage dans le dossier impossible: {0}", "Chargement de l'historique impossible: {0}",
  "Chargement des résultats impossible: {0}", "Chargement impossible : {0}", "Copie impossible: {0}",
  "Impossible d'activer la licence: {0}", "Impossible de vérifier la licence: {0}",
  "Lecture audio indisponible: {0}", "Ouverture impossible: {0}",
  "Suivi du traitement indisponible : {0}", "Sélection impossible : {0}",
]);

export function message(source?: string | null): string {
  if (!source || language === "fr") return source ?? "";
  const direct = t(source);
  if (direct !== source) return direct;
  for (const { key, pattern } of patterns) {
    const match = pattern.exec(source);
    if (match) return wrappedErrors.has(key) ? t(key, message(match[1])) : t(key, ...match.slice(1));
  }
  return source;
}
