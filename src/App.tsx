import { useCallback, useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { StatusPill } from "./components/ui";
import { useLicense } from "./hooks/useLicense";
import { useModels } from "./hooks/useModels";
import { useOutputs } from "./hooks/useOutputs";
import { useTranscription } from "./hooks/useTranscription";
import {
  loadOutputDirectory,
  loadTranscriptionSettings,
  saveOutputDirectory,
  saveTranscriptionSettings,
} from "./lib/preferences";
import { AboutScreen } from "./screens/AboutScreen";
import { AudioScreen } from "./screens/AudioScreen";
import { LicenseScreen } from "./screens/LicenseScreen";
import { ProgressScreen } from "./screens/ProgressScreen";
import { ResultsScreen } from "./screens/ResultsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import type {
  AppDiagnostics,
  EngineStatus,
  LicenseCheck,
  LicenseSnapshot,
  ModelDownloadEvent,
  ModelInventory,
  TranscriptionEvent,
  TranscriptionRequest,
} from "./types";

const steps = ["Licence", "Audio", "Réglages", "Progression", "Résultats", "À propos"] as const;
const audioExtensions = ["m4a", "mp3", "mp4", "mpeg", "mpga", "wav", "webm", "flac", "ogg"];

const stageSteps = [
  { stage: "Préparation", min: 5 },
  { stage: "Préparation audio", min: 10 },
  { stage: "Chargement modèle", min: 25 },
  { stage: "Transcription", min: 35 },
  { stage: "Exports", min: 92 },
  { stage: "Terminé", min: 100 },
];

function App() {
  const [activeStep, setActiveStep] = useState(0);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [appInfo, setAppInfo] = useState<AppDiagnostics | null>(null);
  const [settings, setSettings] = useState(loadTranscriptionSettings);
  const [audioSource, setAudioSource] = useState("");
  const [audioPlaybackMessage, setAudioPlaybackMessage] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateMessage, setUpdateMessage] = useState("");
  const [error, setError] = useState("");

  const {
    license,
    licenseKey,
    setLicenseKey,
    licenseBusy,
    licenseMessage,
    licenseOk,
    hydrateLicense,
    applyLicenseCheck,
    activateLicense,
    validateLicenseOnline,
  } = useLicense();

  const {
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
  } = useModels(settings.model);

  const {
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
  } = useOutputs();

  const handleTranscriptionStarted = useCallback(() => {
    setActiveStep(3);
  }, []);

  const handleRefreshOutputs = useCallback(async (audio = audioPath, dir = outputDir) => {
    try {
      await refreshOutputs(audio, dir);
    } catch (refreshError) {
      setError(`Chargement des résultats impossible: ${String(refreshError)}`);
    }
  }, [audioPath, outputDir, refreshOutputs]);

  const handleRefreshHistory = useCallback(async (dir = outputDir) => {
    try {
      await refreshHistory(dir);
    } catch (refreshError) {
      setError(`Chargement de l'historique impossible: ${String(refreshError)}`);
    }
  }, [outputDir, refreshHistory]);

  const handleTranscriptionCompleted = useCallback(() => {
    void handleRefreshOutputs();
    void handleRefreshHistory();
    setActiveStep(4);
  }, [handleRefreshHistory, handleRefreshOutputs]);

  const transcription = useTranscription({
    onStarted: handleTranscriptionStarted,
    onCompleted: handleTranscriptionCompleted,
    onFailed: setError,
  });

  const canStart = Boolean(engine?.can_run && selectedModelReady && licenseOk && audioPath && outputDir && !transcription.running && !modelBusy);
  const startDisabledReason = (() => {
    if (!licenseOk) return "Licence requise avant de lancer.";
    if (!engine?.can_run) return engine?.message ?? "Backend incomplet.";
    if (!selectedModelReady) return "Téléchargez le modèle sélectionné dans Réglages.";
    if (!audioPath) return "Choisissez un fichier audio.";
    if (!outputDir) return "Choisissez un dossier de sortie.";
    if (transcription.running) return "Transcription déjà en cours.";
    if (modelBusy) return "Téléchargement de modèle en cours.";
    return "";
  })();

  useEffect(() => {
    const boot = async () => {
      try {
        const [engineStatus, licenseState, modelState, diagnostics] = await Promise.all([
          invoke<EngineStatus>("engine_status"),
          invoke<LicenseSnapshot>("read_license_state"),
          invoke<ModelInventory>("model_status"),
          invoke<AppDiagnostics>("app_diagnostics"),
        ]);
        setEngine(engineStatus);
        setAppInfo(diagnostics);
        hydrateModels(modelState);
        const preferredOutputDir = loadOutputDirectory() || engineStatus.default_output_dir;
        setOutputDir(preferredOutputDir);
        setWorkDir(engineStatus.default_work_dir);
        hydrateLicense(licenseState);
        await handleRefreshHistory(preferredOutputDir);
        const validation = await invoke<LicenseCheck>("validate_license", { forceOnline: false });
        applyLicenseCheck(validation);
        if (validation.ok) {
          setActiveStep(1);
        }
      } catch (bootError) {
        setError(String(bootError));
      }
    };

    void boot();
  }, []);

  useEffect(() => {
    saveTranscriptionSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (outputDir) saveOutputDirectory(outputDir);
  }, [outputDir]);

  useEffect(() => {
    let stale = false;
    if (!audioPath) {
      setAudioSource("");
      setAudioPlaybackMessage("");
      return;
    }

    setAudioSource("");
    setAudioPlaybackMessage("Préparation de la lecture audio...");
    invoke<string>("allow_audio_asset", { audioPath })
      .then((allowedPath) => {
        if (stale) return;
        setAudioSource(convertFileSrc(allowedPath));
        setAudioPlaybackMessage("");
      })
      .catch((playbackError) => {
        if (stale) return;
        setAudioPlaybackMessage(`Lecture audio indisponible: ${String(playbackError)}`);
      });

    return () => {
      stale = true;
    };
  }, [audioPath]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenModel: (() => void) | undefined;

    listen<TranscriptionEvent>("transcription-event", (event) => transcription.handleEngineEvent(event.payload)).then((dispose) => {
      unlisten = dispose;
    });
    listen<ModelDownloadEvent>("model-download-event", (event) => handleModelDownloadEvent(event.payload)).then((dispose) => {
      unlistenModel = dispose;
    });

    return () => {
      unlisten?.();
      unlistenModel?.();
    };
  }, [handleModelDownloadEvent, transcription.handleEngineEvent]);

  useEffect(() => {
    if (!audioPath || !outputDir) return;
    void handleRefreshOutputs(audioPath, outputDir);
  }, [audioPath, outputDir, handleRefreshOutputs]);

  const refreshEngineAndModels = useCallback(async () => {
    const [engineStatus, modelState] = await Promise.all([
      invoke<EngineStatus>("engine_status"),
      invoke<ModelInventory>("model_status"),
    ]);
    setEngine(engineStatus);
    hydrateModels(modelState);
  }, [hydrateModels]);

  async function chooseAudio() {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Audio", extensions: audioExtensions }],
    });
    if (typeof selected === "string") {
      setAudioPath(selected);
    }
  }

  async function chooseOutputDir() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setOutputDir(selected);
      await handleRefreshHistory(selected);
    }
  }

  async function handleActivateLicense() {
    setError("");
    try {
      const result = await activateLicense();
      if (result.ok) setActiveStep(1);
    } catch (activationError) {
      setError(String(activationError));
    }
  }

  async function handleValidateLicenseOnline() {
    setError("");
    try {
      await validateLicenseOnline();
    } catch (validationError) {
      setError(String(validationError));
    }
  }

  async function handleDownloadSelectedModel() {
    setError("");
    try {
      await downloadSelectedModel();
      await refreshEngineAndModels();
    } catch (downloadError) {
      setError(String(downloadError));
    }
  }

  async function handleDeleteModels() {
    setError("");
    try {
      await deleteModels();
      await refreshEngineAndModels();
    } catch (deleteError) {
      setError(String(deleteError));
    }
  }

  async function checkForUpdates() {
    setUpdateBusy(true);
    setUpdateProgress(0);
    setUpdateMessage("Recherche de mise à jour...");
    setError("");

    try {
      const update = await check();
      if (!update) {
        setUpdateMessage("Application à jour.");
        return;
      }

      let downloaded = 0;
      let contentLength = 0;
      setUpdateMessage(`Version ${update.version} disponible. Téléchargement...`);

      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          downloaded = 0;
          contentLength = event.data.contentLength ?? 0;
          setUpdateProgress(0);
          setUpdateMessage(`Téléchargement ${update.version}...`);
          return;
        }

        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setUpdateProgress(Math.min(99, Math.round((downloaded / contentLength) * 100)));
          }
          return;
        }

        setUpdateProgress(100);
        setUpdateMessage("Mise à jour installée. Redémarrage...");
      });

      await relaunch();
    } catch (updateError) {
      setUpdateMessage("Mise à jour impossible.");
      setError(String(updateError));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function startTranscription() {
    if (!canStart) return;
    setError("");
    const request: TranscriptionRequest = {
      ...settings,
      audio_path: audioPath,
      output_dir: outputDir,
      work_dir: workDir,
    };
    try {
      await transcription.startTranscription(request);
    } catch (startError) {
      setError(String(startError));
    }
  }

  async function cancelTranscription() {
    try {
      await transcription.cancelTranscription();
    } catch (cancelError) {
      setError(String(cancelError));
    }
  }

  async function copyText(text: string) {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setResultMessage("Contenu copié.");
    } catch (copyError) {
      setError(`Copie impossible: ${String(copyError)}`);
    }
  }

  async function handleExportSelectedSegments() {
    setError("");
    try {
      await exportSelectedSegments();
    } catch (exportError) {
      setError(String(exportError));
    }
  }

  async function handleSaveTranscriptEdits() {
    setError("");
    try {
      await saveTranscriptEdits();
    } catch (saveError) {
      setError(String(saveError));
    }
  }

  const activeScreen = (() => {
    if (activeStep === 0) {
      return (
        <LicenseScreen
          license={license}
          licenseKey={licenseKey}
          licenseBusy={licenseBusy}
          licenseMessage={licenseMessage}
          licenseOk={licenseOk}
          onLicenseKeyChange={setLicenseKey}
          onActivate={handleActivateLicense}
          onValidateOnline={handleValidateLicenseOnline}
          onContinue={() => setActiveStep(1)}
        />
      );
    }

    if (activeStep === 1) {
      return (
        <AudioScreen
          audioPath={audioPath}
          outputDir={outputDir}
          engine={engine}
          onChooseAudio={chooseAudio}
          onChooseOutputDir={chooseOutputDir}
          onRevealAudio={revealItemInDir}
          onContinue={() => setActiveStep(2)}
        />
      );
    }

    if (activeStep === 2) {
      return (
        <SettingsScreen
          settings={settings}
          engine={engine}
          modelInventory={modelInventory}
          selectedModel={selectedModel}
          modelBusy={modelBusy}
          modelProgress={modelProgress}
          modelMessage={modelMessage}
          selectedModelReady={selectedModelReady}
          canStart={canStart}
          startDisabledReason={startDisabledReason}
          onSettingsChange={setSettings}
          onDownloadModel={handleDownloadSelectedModel}
          onDeleteModels={handleDeleteModels}
          onOpenPath={openPath}
          onStart={startTranscription}
        />
      );
    }

    if (activeStep === 3) {
      return (
        <ProgressScreen
          running={transcription.running}
          canStart={canStart}
          disabledReason={startDisabledReason}
          stage={transcription.stage}
          progress={transcription.progress}
          elapsedSeconds={transcription.elapsedSeconds}
          estimatedRemaining={transcription.estimatedRemaining}
          showLogs={transcription.showLogs}
          logLines={transcription.logLines}
          stageSteps={stageSteps}
          onStart={startTranscription}
          onCancel={cancelTranscription}
          onToggleLogs={() => transcription.setShowLogs((value) => !value)}
        />
      );
    }

    if (activeStep === 4) {
      return (
        <ResultsScreen
          audioPath={audioPath}
          audioSource={audioSource}
          audioPlaybackMessage={audioPlaybackMessage}
          outputs={outputs}
          quickOutputs={quickOutputs}
          selectionOutputs={selectionOutputs}
          preview={preview}
          segments={segments}
          selectedSegments={selectedSegments}
          selectedEditableSegments={selectedEditableSegments}
          selectedText={selectedText}
          hasSegmentEdits={hasSegmentEdits}
          history={history}
          resultMessage={resultMessage}
          outputDir={outputDir}
          onOpenPath={openPath}
          onCopyText={copyText}
          onExportSelection={handleExportSelectedSegments}
          onSaveFullTranscript={handleSaveTranscriptEdits}
          onToggleSegment={toggleSegment}
          onSetVisibleSegments={setAllSegments}
          onUpdateSegment={updateSegment}
          onLoadHistoryRecord={(sourceAudio, dir) => {
            setAudioPath(sourceAudio);
            void handleRefreshOutputs(sourceAudio, dir);
          }}
        />
      );
    }

    return (
      <AboutScreen
        appInfo={appInfo}
        engine={engine}
        modelInventory={modelInventory}
        selectedModel={selectedModel}
        license={license}
        licenseOk={licenseOk}
        outputDir={outputDir}
        workDir={workDir}
        onOpenPath={openPath}
      />
    );
  })();

  return (
    <main className="app-shell">
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark">MW</div>
          <div>
            <strong>Microwest Whisper</strong>
            <span>Desktop</span>
          </div>
        </div>

        <nav className="steps">
          {steps.map((step, index) => {
            const stepIndex = index;
            return (
              <button
                key={step}
                className={stepIndex === activeStep ? "step is-active" : "step"}
                type="button"
                onClick={() => setActiveStep(stepIndex)}
              >
                <span>{index + 1}</span>
                {step}
              </button>
            );
          })}
        </nav>

        <div className="engine-box">
          <span className={engine?.can_run ? "dot ok" : "dot warn"} />
          <div>
            <strong>{engine?.can_run ? "Moteur prêt" : "Moteur à vérifier"}</strong>
            <p>{engine?.message ?? "Chargement du moteur..."}</p>
            {engine && <small>{engine.backend}</small>}
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Transcription locale</p>
            <h1>{steps[activeStep]}</h1>
          </div>
          <div className="status-area">
            <div className="status-strip">
              <StatusPill ok={licenseOk} label={licenseOk ? "Licence active" : "Licence requise"} />
              <StatusPill ok={Boolean(engine?.can_run)} label={engine?.can_run ? "whisper.cpp prêt" : "Backend incomplet"} />
              <StatusPill ok={selectedModelReady} label={selectedModelReady ? "Modèle prêt" : "Modèle requis"} />
              <button className="update-button" type="button" disabled={updateBusy} onClick={checkForUpdates}>
                {updateBusy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                Mise à jour
              </button>
            </div>
            {updateMessage && (
              <div className="update-inline">
                <span>{updateMessage}</span>
                {updateBusy && updateProgress > 0 && <strong>{updateProgress}%</strong>}
              </div>
            )}
          </div>
        </header>

        {error && (
          <div className="notice error">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        )}

        {activeScreen}
      </section>
    </main>
  );
}

export default App;
