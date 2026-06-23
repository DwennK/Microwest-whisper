import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModelDownloadEvent, ModelInventory } from "../types";

export function useModels(selectedModelId: string) {
  const [modelInventory, setModelInventory] = useState<ModelInventory | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [modelMessage, setModelMessage] = useState("");

  const selectedModel = useMemo(
    () => modelInventory?.models.find((model) => model.id === selectedModelId),
    [modelInventory, selectedModelId],
  );
  const selectedModelReady = Boolean(selectedModel?.installed);

  const hydrateModels = useCallback((inventory: ModelInventory) => {
    setModelInventory(inventory);
  }, []);

  const handleModelDownloadEvent = useCallback((event: ModelDownloadEvent) => {
    setModelProgress(event.progress);
    setModelMessage(event.line);
    if (event.kind === "completed") {
      setModelBusy(false);
    }
  }, []);

  const downloadSelectedModel = useCallback(async () => {
    setModelBusy(true);
    setModelProgress(0);
    setModelMessage("Préparation du téléchargement...");
    try {
      const updated = await invoke<ModelInventory>("download_model", { model: selectedModelId });
      setModelInventory(updated);
      return updated;
    } finally {
      setModelBusy(false);
    }
  }, [selectedModelId]);

  const deleteModels = useCallback(async () => {
    setModelBusy(true);
    setModelProgress(0);
    setModelMessage("");
    try {
      const updated = await invoke<ModelInventory>("delete_downloaded_models");
      setModelInventory(updated);
      return updated;
    } finally {
      setModelBusy(false);
    }
  }, []);

  return {
    modelInventory,
    selectedModel,
    selectedModelReady,
    modelBusy,
    modelProgress,
    modelMessage,
    hydrateModels,
    handleModelDownloadEvent,
    downloadSelectedModel,
    deleteModels,
  };
}
