import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HistoryRecord, OutputFile, TranscriptSegment } from "../types";

export function useOutputs() {
  const loadVersion = useRef(0);
  const operationLock = useRef(false);
  const [loading, setLoading] = useState(false);
  const [outputBusy, setOutputBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
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
  const [hasSegmentEdits, setHasSegmentEdits] = useState(false);

  const selectedEditableSegments = useMemo(
    () => selectedSegments.map((index) => segments[index]).filter(Boolean),
    [segments, selectedSegments],
  );

  const selectedText = useMemo(
    () => selectedEditableSegments.map((segment) => segment.text.trim()).filter(Boolean).join("\n\n"),
    [selectedEditableSegments],
  );

  const refreshHistory = useCallback(async (dir = outputDir) => {
    if (!dir) return;
    const records = await invoke<HistoryRecord[]>("read_history", { outputDir: dir });
    setHistory(records);
  }, [outputDir]);

  const refreshOutputs = useCallback(async (audio: string, dir: string) => {
    const version = ++loadVersion.current;
    setLoading(true);
    setLoadError("");
    setOutputs([]);
    setSegments([]);
    setPreview("");
    setSelectedSegments([]);
    setSelectionOutputs([]);
    setResultMessage("");
    setHasSegmentEdits(false);
    try {
      if (!audio || !dir) return;
      const [files, loadedSegments] = await Promise.all([
        invoke<OutputFile[]>("expected_outputs", { audioPath: audio, outputDir: dir }),
        invoke<TranscriptSegment[]>("read_transcript_segments", { audioPath: audio, outputDir: dir }),
      ]);
      const previewFile = files.find((item) => item.exists && item.path.endsWith(".clean.txt"));
      const text = previewFile ? await invoke<string>("read_text_preview", { path: previewFile.path }) : "";
      if (version !== loadVersion.current) return;
      setOutputs(files);
      setSegments(loadedSegments);
      setPreview(text);
      setSelectedSegments([]);
    } catch (error) {
      if (version === loadVersion.current) setLoadError(`Chargement impossible : ${String(error)}`);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);

  const updateSegment = useCallback((index: number, text: string) => {
    setResultMessage("");
    setSegments((current) => current.map((segment, itemIndex) => (itemIndex === index ? { ...segment, text } : segment)));
    setHasSegmentEdits(true);
    setSelectionOutputs([]);
  }, []);

  const toggleSegment = useCallback((index: number) => {
    setSelectionOutputs([]);
    setResultMessage("");
    setSelectedSegments((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort((left, right) => left - right),
    );
  }, []);

  const setAllSegments = useCallback((indexes: number[], selected: boolean) => {
    setSelectionOutputs([]);
    setResultMessage("");
    setSelectedSegments((current) => {
      if (!selected) return current.filter((index) => !indexes.includes(index));
      return Array.from(new Set([...current, ...indexes])).sort((left, right) => left - right);
    });
  }, []);

  const exportSelectedSegments = useCallback(async () => {
    if (!audioPath || !outputDir || selectedEditableSegments.length === 0) return;
    if (operationLock.current) return;
    operationLock.current = true;
    setOutputBusy(true);
    setResultMessage("");
    try {
      const files = await invoke<OutputFile[]>("export_selected_segments", {
        request: {
          audio_path: audioPath,
          output_dir: outputDir,
          segments: selectedEditableSegments,
          formats: ["srt", "txt", "docx"],
        },
      });
      setSelectionOutputs(files);
      setResultMessage(`${files.length} fichiers de sélection enregistrés.`);
    } finally {
      operationLock.current = false;
      setOutputBusy(false);
    }
  }, [audioPath, outputDir, selectedEditableSegments]);

  const saveTranscriptEdits = useCallback(async () => {
    if (!audioPath || !outputDir || segments.length === 0) return;
    if (operationLock.current) throw new Error("Un enregistrement est déjà en cours.");
    operationLock.current = true;
    setOutputBusy(true);
    setResultMessage("");
    try {
      const files = await invoke<OutputFile[]>("save_transcript_edits", {
        request: {
          audio_path: audioPath,
          output_dir: outputDir,
          segments,
        },
      });
      setOutputs(files);
      const previewFile = files.find((item) => item.exists && item.path.endsWith(".clean.txt"));
      if (previewFile) {
        setPreview(await invoke<string>("read_text_preview", { path: previewFile.path }));
      }
      setSelectionOutputs([]);
      setHasSegmentEdits(false);
      setResultMessage("Les corrections ont été enregistrées dans les fichiers complets.");
    } finally {
      operationLock.current = false;
      setOutputBusy(false);
    }
  }, [audioPath, outputDir, segments]);

  return {
    loading,
    loadError,
    outputBusy,
    audioPath,
    setAudioPath,
    outputDir,
    setOutputDir,
    workDir,
    setWorkDir,
    outputs,
    selectionOutputs,
    preview,
    segments,
    selectedSegments,
    selectedEditableSegments,
    selectedText,
    hasSegmentEdits,
    history,
    resultMessage,
    setResultMessage,
    refreshHistory,
    refreshOutputs,
    updateSegment,
    toggleSegment,
    setAllSegments,
    exportSelectedSegments,
    saveTranscriptEdits,
  };
}
