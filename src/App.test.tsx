import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
let licenseValid = true;
let developmentMode = false;
let modelInstalled = true;
let saveFails = false;
let nextSegments: Promise<unknown> | null = null;
const handlers = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: (path: string) => `asset://localhost${path}`,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(),
  revealItemInDir: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    licenseValid = true;
    developmentMode = false;
    modelInstalled = true;
    saveFails = false;
    nextSegments = null;
    handlers.clear();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
    listenMock.mockImplementation(async (name: string, callback: (event: { payload: unknown }) => void) => {
      handlers.set(name, callback);
      return () => handlers.delete(name);
    });
    openMock.mockResolvedValue("/audio/meeting.wav");
    invokeMock.mockImplementation((command: string) => {
      if (command === "engine_status") {
        return Promise.resolve({
          backend: "whisper.cpp",
          engine_root: "/engine",
          whisper_cli: "/engine/whisper-cli",
          ffmpeg: "/engine/ffmpeg",
          model_path: "/models/model.bin",
          default_model: "large-v3-turbo-q8_0",
          default_output_dir: "/output",
          default_work_dir: "/work",
          platform: "macos",
          architecture: "aarch64",
          can_run: true,
          message: "Backend natif whisper.cpp prêt.",
        });
      }

      if (command === "read_license_state") {
        return Promise.resolve({
          state: { license_key: "MW-TEST", valid_until: "2099-01-01T00:00:00Z", development_mode: developmentMode },
          status_text: "Licence valide.",
          cached_valid: licenseValid,
        });
      }

      if (command === "model_status") {
        return Promise.resolve({
          models_dir: "/models",
          total_downloaded_bytes: 874_188_075,
          models: [
            {
              id: "large-v3-turbo-q8_0",
              label: "large-v3-turbo q8_0",
              filename: "ggml-large-v3-turbo-q8_0.bin",
              url: "https://example.test/model.bin",
              size_bytes: 874_188_075,
              size_label: "834 MiB",
              installed: modelInstalled,
              path: "/models/model.bin",
              source: "downloaded",
            },
          ],
        });
      }

      if (command === "app_diagnostics") {
        return Promise.resolve({
          name: "Microwest Whisper",
          version: "0.2.3",
          backend: "whisper.cpp",
          platform: "macos",
          architecture: "aarch64",
          engine_root: "/engine",
          default_output_dir: "/output",
          default_work_dir: "/work",
          model_dir: "/models",
          license_state_path: "/license.json",
          update_endpoint: "https://example.test/latest.json",
        });
      }

      if (command === "read_history") {
        return Promise.resolve([]);
      }

      if (command === "validate_license") {
        return Promise.resolve({
          ok: licenseValid,
          message: "Licence valide.",
          state: { license_key: "MW-TEST", valid_until: "2099-01-01T00:00:00Z", development_mode: developmentMode },
          online: false,
        });
      }

      if (command === "allow_audio_asset") {
        return Promise.resolve("/audio/meeting.wav");
      }

      if (command === "expected_outputs" || command === "save_transcript_edits" || command === "export_selected_segments") {
        if (command === "save_transcript_edits" && saveFails) return Promise.reject(new Error("Disque plein"));
        return Promise.resolve([{ label: "Texte propre", path: "/output/meeting.clean.txt", exists: true }]);
      }
      if (command === "read_transcript_segments") return nextSegments ?? Promise.resolve([{ start: 0, end: 4, text: "Texte original" }]);
      if (command === "read_text_preview") return Promise.resolve("Texte original");
      if (command === "download_model") { modelInstalled = true; return invokeMock("model_status"); }
      if (command === "activate_license") { licenseValid = true; return invokeMock("validate_license"); }
      return Promise.resolve(null);
    });

  });

  it("boots with mocked Tauri state and skips to audio when the license is valid", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Audio" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Licence active").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /Licence/ })).toBeInTheDocument();
    expect(screen.getByText("Moteur prêt")).toBeInTheDocument();
    expect(listenMock).toHaveBeenCalledWith("transcription-event", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("model-download-event", expect.any(Function));
  });

  async function chooseFile() {
    await screen.findByRole("heading", { name: "Audio" });
    fireEvent.click(screen.getByRole("button", { name: "Choisir un fichier" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Transcrire" })).toBeEnabled());
  }
  function navigate(name: string) {
    fireEvent.click(within(screen.getByRole("navigation", { name: "Étapes de transcription" })).getByRole("button", { name: new RegExp(name) }));
  }
  async function editTranscript() {
    render(<App />);
    await chooseFile();
    navigate("Résultats");
    fireEvent.click(await screen.findByRole("button", { name: "Corriger" }));
    fireEvent.change(await screen.findByLabelText("Texte du segment 1"), { target: { value: "Texte corrigé" } });
  }
  async function requestReplacement() {
    navigate("Audio");
    openMock.mockResolvedValue("/audio/other.wav");
    fireEvent.click(screen.getByRole("button", { name: "Changer de fichier" }));
    return screen.findByRole("dialog");
  }

  it("starts directly with defaults, blocks duplicate starts and file changes until completion", async () => {
    render(<App />);
    await chooseFile();
    const start = screen.getByRole("button", { name: "Transcrire" });
    fireEvent.click(start); fireEvent.click(start);
    await waitFor(() => expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "start_transcription")).toHaveLength(1));
    expect(invokeMock).toHaveBeenCalledWith("start_transcription", { request: expect.objectContaining({ language: "fr", model: "large-v3-turbo-q8_0", audio_path: "/audio/meeting.wav" }) });
    navigate("Audio");
    expect(screen.getByRole("button", { name: "Changer de fichier" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Changer le dossier" })).toBeDisabled();
    await act(async () => handlers.get("transcription-event")?.({ payload: { kind: "completed", stage: "Terminé", line: "Terminé", progress: 100 } }));
    expect(await screen.findByRole("heading", { name: "Résultats" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Corriger" })).toBeEnabled();
  });

  it("preserves custom settings and uses them without requiring another settings visit", async () => {
    render(<App />);
    await chooseFile();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Application" })).getByRole("button", { name: "Réglages" }));
    fireEvent.change(screen.getByLabelText("Langue"), { target: { value: "en" } });
    fireEvent.change(screen.getByLabelText("Calcul"), { target: { value: "cpu" } });
    fireEvent.click(screen.getByRole("button", { name: "Retour au fichier" }));
    expect(screen.getByText("Anglais")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Transcrire" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("start_transcription", { request: expect.objectContaining({ language: "en", device: "cpu" }) }));
  });

  it("shows activation when required and allows model download without starting automatically", async () => {
    licenseValid = false; modelInstalled = false;
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Licence" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activer" }));
    await chooseFileWithoutReady();
    expect(screen.getByRole("button", { name: "Transcrire" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Télécharger · 834 MiB/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Transcrire" })).toBeEnabled());
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "start_transcription")).toBe(false);
  });

  async function chooseFileWithoutReady() {
    await screen.findByRole("heading", { name: "Audio" });
    fireEvent.click(screen.getByRole("button", { name: "Choisir un fichier" }));
    await screen.findByText("meeting.wav");
  }

  it("keeps edits through navigation and through the stay choice", async () => {
    await editTranscript();
    const dialog = await requestReplacement();
    fireEvent.click(within(dialog).getByRole("button", { name: "Rester" }));
    navigate("Résultats");
    expect(screen.getByLabelText("Texte du segment 1")).toHaveValue("Texte corrigé");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves corrections against the previous source before replacing it", async () => {
    await editTranscript();
    const dialog = await requestReplacement();
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer et continuer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith("save_transcript_edits", { request: expect.objectContaining({ audio_path: "/audio/meeting.wav", segments: [{ start: 0, end: 4, text: "Texte corrigé" }] }) });
    expect(screen.getByText("other.wav")).toBeInTheDocument();
  });

  it("keeps the original document and dialog when saving fails", async () => {
    await editTranscript(); saveFails = true;
    const dialog = await requestReplacement();
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer et continuer" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Disque plein");
    expect(invokeMock).not.toHaveBeenCalledWith("read_transcript_segments", expect.objectContaining({ audioPath: "/audio/other.wav" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Rester" }));
    navigate("Résultats");
    expect(screen.getByLabelText("Texte du segment 1")).toHaveValue("Texte corrigé");
  });

  it("discards only on explicit choice and hides the previous text throughout loading", async () => {
    await editTranscript();
    let resolve!: (value: unknown) => void;
    nextSegments = new Promise((done) => { resolve = done; });
    const dialog = await requestReplacement();
    fireEvent.click(within(dialog).getByRole("button", { name: "Abandonner les corrections" }));
    // The confirmation remains locked until replacement finishes.
    expect(await screen.findByText("other.wav")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Texte corrigé")).not.toBeInTheDocument();
    await act(async () => resolve([{ start: 0, end: 2, text: "Autre texte" }]));
    navigate("Résultats");
    expect(await screen.findByText("Autre texte")).toBeInTheDocument();
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "save_transcript_edits")).toBe(false);
  });

  it("protects a folder change as well as a file change", async () => {
    await editTranscript(); navigate("Audio");
    openMock.mockResolvedValue("/other-output");
    fireEvent.click(screen.getByRole("button", { name: "Changer le dossier" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer et continuer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith("save_transcript_edits", { request: expect.objectContaining({ output_dir: "/output" }) });
    expect(invokeMock).toHaveBeenCalledWith("expected_outputs", { audioPath: "/audio/meeting.wav", outputDir: "/other-output" });
  });

  it("identifies development access without presenting it as an active licence", async () => {
    developmentMode = true;
    render(<App />);
    await screen.findByRole("heading", { name: "Audio" });
    expect(screen.getByText("Mode développement")).toBeInTheDocument();
    expect(screen.queryByText("Licence active")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("navigation", { name: "Application" })).getByRole("button", { name: "Licence" }));
    expect(screen.getByText(/Aucune licence n’est enregistrée/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activer" })).not.toBeInTheDocument();
  });

});
