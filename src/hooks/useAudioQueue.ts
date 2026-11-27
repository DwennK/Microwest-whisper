import { useRef, useState } from "react";
import type { TranscriptionEvent, TranscriptionRequest } from "../types";

export interface QueueItem {
  path: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
}

export function pendingFile(path: string): QueueItem {
  return { path, status: "pending" };
}

export function useAudioQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const active = useRef(false);
  const stopRequested = useRef(false);

  async function run(request: TranscriptionRequest, runFile: (request: TranscriptionRequest) => Promise<TranscriptionEvent>) {
    if (active.current) return;
    active.current = true;
    stopRequested.current = false;
    setRunning(true);
    function mark(path: string, status: QueueItem["status"], error?: string) {
      setItems(current => current.map(item => item.path === path ? { path, status, error } : item));
    }
    try {
      for (const item of items.filter(item => item.status !== "completed")) {
        if (stopRequested.current) break;
        mark(item.path, "running");
        try {
          const event = await runFile({ ...request, audio_path: item.path });
          if (event.kind === "cancelled") {
            mark(item.path, "cancelled");
            break;
          }
          if (event.kind === "failed") mark(item.path, "failed", event.line);
          else mark(item.path, "completed");
        } catch (error) {
          // The engine rejected the launch (for example, an expired license).
          mark(item.path, "failed", String(error));
          break;
        }
      }
    } finally {
      active.current = false;
      setRunning(false);
    }
  }
  return { items, setItems, running, active, stopRequested, run };
}
