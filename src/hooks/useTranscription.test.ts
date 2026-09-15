import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTranscription } from "./useTranscription";
import { defaultTranscriptionSettings } from "../lib/preferences";
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
const request = { ...defaultTranscriptionSettings, audio_path: "/audio.wav", output_dir: "/out" };
const event = (kind: "cancelled" | "completed" | "failed") => ({ kind, stage: kind, line: kind, stream: "system", progress: 0 });
describe("useTranscription", () => {
  beforeEach(() => { invokeMock.mockReset(); });
  it("locks synchronously before the start request settles and recovers from rejection", async () => {
    let reject!: (error: Error) => void;
    invokeMock.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    const onStarted = vi.fn();
    const { result } = renderHook(() => useTranscription({ onStarted, onCompleted: vi.fn(), onFailed: vi.fn() }));
    let start!: Promise<void>;
    act(() => { start = result.current.startTranscription(request); void result.current.startTranscription(request); });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("starting");
    expect(result.current.running).toBe(true);
    await act(async () => { reject(new Error("Moteur indisponible")); await expect(start).rejects.toThrow("Moteur indisponible"); });
    expect(result.current.phase).toBe("failed");
    expect(result.current.running).toBe(false);
  });
  it("waits for cancellation confirmation and ignores duplicate terminal events", async () => {
    invokeMock.mockResolvedValue({});
    const completed = vi.fn();
    const { result } = renderHook(() => useTranscription({ onStarted: vi.fn(), onCompleted: completed, onFailed: vi.fn() }));
    await act(async () => result.current.startTranscription(request));
    await act(async () => result.current.cancelTranscription());
    expect(result.current.phase).toBe("cancelling");
    expect(result.current.running).toBe(true);
    act(() => result.current.handleEngineEvent(event("cancelled")));
    expect(result.current.phase).toBe("cancelled");
    expect(result.current.running).toBe(false);
    act(() => result.current.handleEngineEvent(event("completed")));
    expect(completed).not.toHaveBeenCalled();
  });
  it("recovers cancellation controls on a failed cancel request and reports engine failures", async () => {
    invokeMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Annulation refusée"));
    const failed = vi.fn();
    const { result } = renderHook(() => useTranscription({ onStarted: vi.fn(), onCompleted: vi.fn(), onFailed: failed }));
    await act(async () => result.current.startTranscription(request));
    await act(async () => { await expect(result.current.cancelTranscription()).rejects.toThrow("Annulation refusée"); });
    expect(result.current.phase).toBe("running");
    act(() => result.current.handleEngineEvent(event("failed")));
    expect(result.current.phase).toBe("failed");
    expect(failed).toHaveBeenCalledWith("failed");
  });
  it("resets previous progress for a new source while keeping an active job locked", async () => {
    invokeMock.mockResolvedValue({});
    const { result } = renderHook(() => useTranscription({ onStarted: vi.fn(), onCompleted: vi.fn(), onFailed: vi.fn() }));
    await act(async () => result.current.startTranscription(request));
    act(() => result.current.resetTranscription());
    expect(result.current.running).toBe(true);
    act(() => result.current.handleEngineEvent({ ...event("completed"), progress: 100 }));
    act(() => result.current.resetTranscription());
    expect(result.current.phase).toBe("idle");
    expect(result.current.progress).toBe(0);
    expect(result.current.logLines).toEqual([]);
  });

});
