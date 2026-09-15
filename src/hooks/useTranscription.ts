import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TranscriptionEvent, TranscriptionRequest } from "../types";

export type TranscriptionPhase = "idle" | "starting" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
interface UseTranscriptionOptions {
  onStarted: () => void;
  onCompleted: () => void;
  onFailed: (message: string) => void;
}

export function useTranscription({ onStarted, onCompleted, onFailed }: UseTranscriptionOptions) {
  const [phase, setPhase] = useState<TranscriptionPhase>("idle");
  const locked = useRef(false);
  const cancelPending = useRef(false);
  const [stage, setStage] = useState("En attente");
  const [progress, setProgress] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const running = phase === "starting" || phase === "running" || phase === "cancelling";

  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = window.setInterval(() => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const estimatedRemaining = useMemo(() =>
    phase === "running" && stage === "Transcription" && elapsedSeconds >= 3 && progress > 35 && progress < 92
      ? Math.max(0, Math.round((elapsedSeconds / progress) * (100 - progress))) : null,
  [phase, stage, progress, elapsedSeconds]);

  const handleEngineEvent = useCallback((event: TranscriptionEvent) => {
    if (event.kind === "started") {
      locked.current = true;
      setPhase(cancelPending.current ? "cancelling" : "running");
      setProgress(5);
      setStage(event.stage);
      setLogLines([event.line]);
      return;
    }
    if (event.kind === "completed" || event.kind === "cancelled" || event.kind === "failed") {
      if (!locked.current) return;
      locked.current = false;
      cancelPending.current = false;
      setPhase(event.kind);
      setStage(event.kind === "completed" ? "Terminé" : event.kind === "cancelled" ? "Annulé" : "Échec");
      if (event.kind === "completed") setProgress(100);
      setStartedAt(null);
      setLogLines((lines) => [...lines.slice(-250), event.line]);
      if (event.kind === "completed") onCompleted();
      if (event.kind === "failed") onFailed(event.line);
      return;
    }
    if (!locked.current) return;
    if (event.progress > 0) {
      setProgress((current) => Math.max(current, event.progress));
      setStage(event.stage);
    }
    setLogLines((lines) => [...lines.slice(-250), `[${event.stream}] ${event.line}`]);
  }, [onCompleted, onFailed]);

  const startTranscription = useCallback(async (request: TranscriptionRequest) => {
    if (locked.current) return;
    locked.current = true;
    cancelPending.current = false;
    setPhase("starting");
    setProgress(0);
    setStage("Préparation");
    setStartedAt(Date.now());
    setElapsedSeconds(0);
    setLogLines([]);
    setShowLogs(false);
    onStarted();
    try {
      await invoke("start_transcription", { request });
      setPhase((current) => current === "starting" ? "running" : current);
    } catch (error) {
      locked.current = false;
      setPhase("failed");
      setStage("Échec");
      setStartedAt(null);
      throw error;
    }
  }, [onStarted]);

  const cancelTranscription = useCallback(async () => {
    if (!locked.current || cancelPending.current || phase === "starting") return;
    cancelPending.current = true;
    setPhase("cancelling");
    try {
      await invoke("cancel_transcription");
    } catch (error) {
      cancelPending.current = false;
      if (locked.current) setPhase("running");
      throw error;
    }
  }, [phase]);

  const resetTranscription = useCallback(() => {
    if (locked.current) return;
    setPhase("idle");
    setStage("En attente");
    setProgress(0);
    setStartedAt(null);
    setElapsedSeconds(0);
    setLogLines([]);
    setShowLogs(false);
  }, []);

  return { resetTranscription, phase, running, stage, progress, elapsedSeconds, estimatedRemaining, showLogs, setShowLogs, logLines, handleEngineEvent, startTranscription, cancelTranscription };
}
