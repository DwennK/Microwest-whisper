import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HistoryRecord, OutputFile, TranscriptSegment } from "../types";

export function useOutputs() {
  const [audioPath, setAudioPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [workDir, setWorkDir] = useState("");
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [selectionOutputs, setSelectionOutputs] = useState<OutputFile[]>([]);
  const [preview, setPreview] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [selectedSegments, setSelectedSegments] = useState<number[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [resultMessage, setResultMessage] = useState("");

  const selectedEditableSegments = useMemo(
    () => selectedSegments.map((index) => segments[index]).filter(Boolean),
    [segments, selectedSegments],
  );

  const selectedText = useMemo(
    () => selectedEditableSegments.map((segment) => segment.text.trim()).filter(Boolean).join("\n\n"),
    [selectedEditableSegments],
  );

  const quickOutputs = useMemo(
    () =>
      outputs.filter((item) =>
        [".transcript.docx", ".transcript.md", ".segments.srt"].some((suffix) => item.path.endsWith(suffix)),
      ),
    [outputs],
  );

  const refreshHistory = useCallback(async (dir = outputDir) => {
    if (!dir) return;
    const records = await invoke<HistoryRecord[]>("read_history", { outputDir: dir });
    setHistory(records);
  }, [outputDir]);

  const refreshOutputs = useCallback(async (audio = audioPath, dir = outputDir) => {
    if (!audio || !dir) return;
    const files = await invoke<OutputFile[]>("expected_outputs", { audioPath: audio, outputDir: dir });
    setOutputs(files);
    const previewFile = files.find((item) => item.exists && item.path.endsWith(".transcript.md")) ?? files.find((item) => item.exists && item.path.endsWith(".clean.txt"));
    if (previewFile) {
      setPreview(await invoke<string>("read_text_preview", { path: previewFile.path }));
    } else {
      setPreview("");
    }
    const loadedSegments = await invoke<TranscriptSegment[]>("read_transcript_segments", { audioPath: audio, outputDir: dir });
    setSegments(loadedSegments);
    setSelectedSegments(loadedSegments.map((_, index) => index));
    setSelectionOutputs([]);
  }, [audioPath, outputDir]);

  const updateSegment = useCallback((index: number, text: string) => {
    setSegments((current) => current.map((segment, itemIndex) => (itemIndex === index ? { ...segment, text } : segment)));
  }, []);

  const toggleSegment = useCallback((index: number) => {
    setSelectedSegments((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort((left, right) => left - right),
    );
  }, []);

  const setAllSegments = useCallback((indexes: number[], selected: boolean) => {
    setSelectedSegments((current) => {
      if (!selected) return current.filter((index) => !indexes.includes(index));
      return Array.from(new Set([...current, ...indexes])).sort((left, right) => left - right);
    });
  }, []);

  const exportSelectedSegments = useCallback(async () => {
    if (!audioPath || !outputDir || selectedEditableSegments.length === 0) return;
    setResultMessage("");
    const files = await invoke<OutputFile[]>("export_selected_segments", {
      request: {
        audio_path: audioPath,
        output_dir: outputDir,
        segments: selectedEditableSegments,
        formats: ["markdown", "txt", "srt", "json", "docx"],
      },
    });
    setSelectionOutputs(files);
    setResultMessage(`${files.length} export(s) de sélection généré(s).`);
  }, [audioPath, outputDir, selectedEditableSegments]);

  return {
    audioPath,
    setAudioPath,
    outputDir,
    setOutputDir,
    workDir,
    setWorkDir,
    outputs,
    quickOutputs,
    selectionOutputs,
    preview,
    segments,
    selectedSegments,
    selectedEditableSegments,
    selectedText,
    history,
    resultMessage,
    setResultMessage,
    refreshHistory,
    refreshOutputs,
    updateSegment,
    toggleSegment,
    setAllSegments,
    exportSelectedSegments,
  };
}
