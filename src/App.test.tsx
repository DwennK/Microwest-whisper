import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
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
  it("boots with mocked Tauri state and renders the license screen", async () => {
    listenMock.mockResolvedValue(() => undefined);
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
          state: { license_key: "MW-TEST", valid_until: "2099-01-01T00:00:00Z" },
          status_text: "Licence valide.",
          cached_valid: true,
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
              installed: true,
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
          ok: true,
          message: "Licence valide.",
          state: { license_key: "MW-TEST", valid_until: "2099-01-01T00:00:00Z" },
          online: false,
        });
      }

      return Promise.resolve(null);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Licence" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Licence active").length).toBeGreaterThan(0));
    expect(screen.getByText("Moteur prêt")).toBeInTheDocument();
    expect(listenMock).toHaveBeenCalledWith("transcription-event", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("model-download-event", expect.any(Function));
  });
});
