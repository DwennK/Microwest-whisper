import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOutputs } from "./useOutputs";
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
describe("useOutputs", () => {
  beforeEach(() => { invokeMock.mockReset(); });
  it("commits only the newest load even if an older request finishes last", async () => {
    const first = deferred<unknown[]>();
    invokeMock.mockImplementation((command, args) => {
      if (command === "expected_outputs") return Promise.resolve([]);
      if (args.audioPath === "first.wav") return first.promise;
      return Promise.resolve([{ start: 0, end: 1, text: "Second" }]);
    });
    const { result } = renderHook(() => useOutputs());
    let old!: Promise<void>;
    act(() => { old = result.current.refreshOutputs("first.wav", "/out"); });
    await act(async () => result.current.refreshOutputs("second.wav", "/out"));
    expect(result.current.segments[0].text).toBe("Second");
    await act(async () => { first.resolve([{ start: 0, end: 1, text: "First" }]); await old; });
    expect(result.current.segments[0].text).toBe("Second");
    expect(result.current.loading).toBe(false);
  });
  it("starts without selected excerpts and invalidates an exported selection after changes", async () => {
    invokeMock.mockImplementation((command) => Promise.resolve(command === "read_transcript_segments" ? [{ start: 0, end: 1, text: "Premier" }, { start: 2, end: 3, text: "Second" }] : command === "export_selected_segments" ? [{ label: "Texte", path: "/out/selection.txt", exists: true }] : []));
    const { result } = renderHook(() => useOutputs());
    act(() => { result.current.setAudioPath("test.wav"); result.current.setOutputDir("/out"); });
    await act(async () => result.current.refreshOutputs("test.wav", "/out"));
    expect(result.current.selectedSegments).toEqual([]);
    act(() => result.current.toggleSegment(1));
    await act(async () => result.current.exportSelectedSegments());
    expect(result.current.selectionOutputs).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith("export_selected_segments", { request: expect.objectContaining({ segments: [{ start: 2, end: 3, text: "Second" }] }) });
    act(() => result.current.toggleSegment(0));
    expect(result.current.selectionOutputs).toEqual([]);
    expect(result.current.resultMessage).toBe("");
    await act(async () => result.current.exportSelectedSegments());
    act(() => result.current.updateSegment(0, "Corrigé"));
    expect(result.current.selectionOutputs).toEqual([]);
  });
  it("clears the previous result immediately and reports failed loading without stale output", async () => {
    invokeMock.mockImplementation((command) => Promise.resolve(command === "expected_outputs" ? [] : [{ start: 0, end: 1, text: "First" }]));
    const { result } = renderHook(() => useOutputs());
    await act(async () => result.current.refreshOutputs("first.wav", "/out"));
    invokeMock.mockRejectedValue(new Error("Lecture refusée"));
    await act(async () => result.current.refreshOutputs("second.wav", "/out"));
    expect(result.current.segments).toEqual([]);
    expect(result.current.preview).toBe("");
    expect(result.current.loadError).toContain("Lecture refusée");
    expect(result.current.loading).toBe(false);
  });
});
