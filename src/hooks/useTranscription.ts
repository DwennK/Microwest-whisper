import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TranscriptionEvent, TranscriptionRequest } from "../types";

interface UseTranscriptionOptions {
  onStarted: () => void;
  onCompleted: () => void;
  onFailed: (message: string) => void;
}

export function useTranscription({ onStarted, onCompleted, onFailed }: UseTranscriptionOptions) {
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState("En attente");
  const [progress, setProgress] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);

  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const estimatedRemaining = useMemo(
    () =>
      running && progress > 10 && progress < 100
        ? Math.max(0, Math.round((elapsedSeconds / progress) * (100 - progress)))
        : null,
    [elapsedSeconds, progress, running],
  );

  const handleEngineEvent = useCallback((event: TranscriptionEvent) => {
    if (event.kind === "started") {
      setRunning(true);
      setProgress(5);
      setStage(event.stage);
      setStartedAt(Date.now());
      setElapsedSeconds(0);
      setLogLines([event.line]);
      onStarted();
      return;
    }

    if (event.kind === "completed") {
      setRunning(false);
      setProgress(100);
      setStage("Terminé");
      setStartedAt(null);
      setLogLines((lines) => [...lines, event.line]);
      onCompleted();
      return;
    }

    if (event.kind === "cancelled") {
      setRunning(false);
      setStartedAt(null);
      setStage("Annulé");
      setLogLines((lines) => [...lines, event.line]);
      return;
    }

    if (event.kind === "failed") {
      setRunning(false);
      setStartedAt(null);
      setStage("Échec");
      setLogLines((lines) => [...lines, event.line]);
      onFailed(event.line);
      return;
    }

    if (event.progress > 0) {
      setProgress((current) => Math.max(current, event.progress));
      setStage(event.stage);
    }
    setLogLines((lines) => [...lines.slice(-250), `[${event.stream}] ${event.line}`]);
  }, [onCompleted, onFailed, onStarted]);

  const startTranscription = useCallback(async (request: TranscriptionRequest) => {
    setProgress(0);
    setStage("Préparation");
    setLogLines([]);
    setShowLogs(false);
    await invoke("start_transcription", { request });
  }, []);

  const cancelTranscription = useCallback(async () => {
    if (!running) return;
    await invoke("cancel_transcription");
  }, [running]);

  return {
    running,
    stage,
    progress,
    elapsedSeconds,
    estimatedRemaining,
    showLogs,
    setShowLogs,
    logLines,
    handleEngineEvent,
    startTranscription,
    cancelTranscription,
  };
}
