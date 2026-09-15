import appIcon from "../assets/app-icon-small.png";
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { AudioLines, FileAudio, FileText, CircleAlert, Info, Loader2, RefreshCw, Settings2, ShieldCheck, X } from "lucide-react";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
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

const steps = ["Licence", "Audio", "Réglages", "Transcription", "Résultats", "À propos"] as const;
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
  const [activeStep, setActiveStep] = useState(1);
  const [booting, setBooting] = useState(true);
  const [eventsReady, setEventsReady] = useState(false);
  const [pendingChange, setPendingChange] = useState<(() => void | Promise<void>) | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  const changeLock = useRef(false);
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

  const canStart = Boolean(engine?.can_run && selectedModelReady && licenseOk && audioPath && outputDir && !transcription.running && !modelBusy && !loading && !outputBusy && !booting && eventsReady && !changeBusy);
  const startDisabledReason = (() => {
    if (booting) return "Préparation de l’application…";
    if (!eventsReady) return "Connexion au suivi du traitement…";
    if (loading) return "Chargement du fichier…";
    if (outputBusy) return "Enregistrement en cours…";
    if (!licenseOk) return "Licence requise avant de lancer.";
    if (!selectedModelReady) return "Téléchargez le modèle sélectionné pour commencer.";
    if (!engine?.can_run) return engine?.message ?? "Moteur incomplet.";
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
        setActiveStep(validation.ok ? 1 : 0);
      } catch (bootError) {
        setError(String(bootError));
      } finally {
        setBooting(false);
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

  // Keep one subscription so navigation and output changes cannot drop events.
  const eventHandlers = useRef({ transcription: transcription.handleEngineEvent, model: handleModelDownloadEvent });
  useEffect(() => {
    eventHandlers.current = { transcription: transcription.handleEngineEvent, model: handleModelDownloadEvent };
  });
  useEffect(() => {
    let disposed = false;
    const disposers: (() => void)[] = [];
    const register = async () => {
      let registered = 0;
      for (const [name, callback] of [
        ["transcription-event", (event: { payload: TranscriptionEvent }) => eventHandlers.current.transcription(event.payload)],
        ["model-download-event", (event: { payload: ModelDownloadEvent }) => eventHandlers.current.model(event.payload)],
      ] as const) {
        try {
          const stop = await listen(name, callback as (event: { payload: unknown }) => void);
          if (disposed) stop(); else { disposers.push(stop); registered++; }
        } catch (error) { if (!disposed) setError(`Suivi du traitement indisponible : ${String(error)}`); }
      }
      if (!disposed) setEventsReady(registered === 2);
    };
    void register();
    return () => { disposed = true; disposers.forEach((stop) => stop()); };
  }, []);

  const refreshEngineAndModels = useCallback(async () => {
    const [engineStatus, modelState] = await Promise.all([
      invoke<EngineStatus>("engine_status"),
      invoke<ModelInventory>("model_status"),
    ]);
    setEngine(engineStatus);
    hydrateModels(modelState);
  }, [hydrateModels]);

  const controlsLocked = transcription.running || outputBusy || changeBusy || loading;

  async function runChange(action: () => void | Promise<void>, save = false) {
    if (changeLock.current) return;
    changeLock.current = true;
    setChangeBusy(true);
    setError("");
    try {
      if (save) await saveTranscriptEdits();
      await action();
      setPendingChange(null);
    } catch (error) {
      setError(String(error));
    } finally {
      changeLock.current = false;
      setChangeBusy(false);
    }
  }

  function requestChange(action: () => void | Promise<void>) {
    if (controlsLocked || pendingChange) return;
    if (hasSegmentEdits) setPendingChange(() => action);
    else void runChange(action);
  }

  async function replaceSource(audio: string, dir: string) {
    transcription.resetTranscription();
    setAudioPath(audio);
    setOutputDir(dir);
    await Promise.all([refreshOutputs(audio, dir), handleRefreshHistory(dir)]);
  }

  async function chooseAudio() {
    if (controlsLocked) return;
    try {
      const selected = await openDialog({ multiple: false, filters: [{ name: "Audio", extensions: audioExtensions }] });
      if (typeof selected === "string" && selected !== audioPath) requestChange(() => replaceSource(selected, outputDir));
    } catch (error) { setError(`Sélection impossible : ${String(error)}`); }
  }

  async function chooseOutputDir() {
    if (controlsLocked) return;
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string" && selected !== outputDir) requestChange(() => replaceSource(audioPath, selected));
    } catch (error) { setError(`Sélection impossible : ${String(error)}`); }
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
    if (transcription.running || modelBusy) return;
    setError("");
    try {
      await downloadSelectedModel();
      await refreshEngineAndModels();
    } catch (downloadError) {
      setError(String(downloadError));
    }
  }

  async function handleDeleteModels() {
    if (transcription.running || modelBusy) return;
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

  function startTranscription() {
    if (!canStart) return;
    const request: TranscriptionRequest = { ...settings, audio_path: audioPath, output_dir: outputDir, work_dir: workDir };
    requestChange(async () => {
      await transcription.startTranscription(request);
    });
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

  async function handleOpenPath(path: string) {
    if (!path.trim()) return;
    setError("");
    try {
      await openPath(path);
      setResultMessage("Fichier ouvert dans l’application par défaut.");
    } catch (openError) {
      setError(`Ouverture impossible: ${String(openError)}`);
    }
  }

  async function handleRevealPath(path: string) {
    if (!path.trim()) return;
    setError("");
    try {
      await revealItemInDir(path);
      setResultMessage("Fichier affiché dans son dossier.");
    } catch (revealError) {
      setError(`Affichage dans le dossier impossible: ${String(revealError)}`);
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

  function navigateToStep(step: number) {
    setError("");
    setActiveStep(step);
  }

  const activeScreen = (() => {
    if (booting) return <div className="screen loading-state" role="status"><Loader2 className="spin" />Préparation de l’application…</div>;
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
          onContinue={() => navigateToStep(1)}
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
          onRevealAudio={handleRevealPath}
          language={settings.language}
          model={settings.model}
          selectedModel={selectedModel}
          modelReady={selectedModelReady}
          modelBusy={modelBusy}
          modelProgress={modelProgress}
          modelMessage={modelMessage}
          locked={controlsLocked}
          canStart={canStart}
          disabledReason={startDisabledReason}
          onSettings={() => navigateToStep(2)}
          onDownload={handleDownloadSelectedModel}
          onStart={startTranscription}
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
          locked={transcription.running || modelBusy}
          onBack={() => navigateToStep(1)}
          onSettingsChange={setSettings}
          onDownloadModel={handleDownloadSelectedModel}
          onDeleteModels={handleDeleteModels}
          onOpenPath={handleOpenPath}
          onStart={startTranscription}
        />
      );
    }

    if (activeStep === 3) {
      return (
        <ProgressScreen
          audioPath={audioPath}
          phase={transcription.phase}
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
          onAudio={() => navigateToStep(1)}
          onResults={() => navigateToStep(4)}
          onToggleLogs={() => transcription.setShowLogs((value) => !value)}
        />
      );
    }

    if (activeStep === 4) {
      if (loading) return <div className="screen loading-state" role="status"><Loader2 className="spin" />Chargement de la transcription…</div>;
      if (loadError) return <div className="screen"><p role="alert">{loadError}</p><button type="button" onClick={() => void refreshOutputs(audioPath, outputDir)}>Réessayer le chargement</button></div>;
      return (
        <ResultsScreen
          key={`${audioPath}|${outputDir}`}
          busy={outputBusy || transcription.running || changeBusy}
          resultError={error}
          audioPath={audioPath}
          audioSource={audioSource}
          audioPlaybackMessage={audioPlaybackMessage}
          outputs={outputs}
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
          onOpenPath={handleOpenPath}
          onRevealPath={handleRevealPath}
          onCopyText={copyText}
          onExportSelection={handleExportSelectedSegments}
          onSaveFullTranscript={handleSaveTranscriptEdits}
          onToggleSegment={toggleSegment}
          onSetVisibleSegments={setAllSegments}
          onUpdateSegment={updateSegment}
          onAudio={() => navigateToStep(1)}
          onLoadHistoryRecord={(sourceAudio, dir) => {
            if (sourceAudio !== audioPath || dir !== outputDir) requestChange(() => replaceSource(sourceAudio, dir));
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
        onOpenPath={handleOpenPath}
      />
    );
  })();

  return (
    <main className="app-shell">
      <aside className="rail">
        <div className="brand">
          <img className="brand-icon" src={appIcon} alt="" width={46} height={46} />
          <div>
            <strong>Microwest <span className="brand-product">Whisper</span></strong>
            <span>Transcription locale</span>
          </div>
        </div>

        <p className="rail-label">Votre espace</p>
        <nav className="steps" aria-label="Étapes de transcription">
          {[1, 3, 4].map((stepIndex, index) => (
            <button key={stepIndex} className={stepIndex === activeStep ? "step is-active" : "step"}
              type="button" aria-current={stepIndex === activeStep ? "step" : undefined}
              disabled={booting} onClick={() => navigateToStep(stepIndex)}>
              {stepIndex === 1 ? <FileAudio size={19} /> : stepIndex === 3 ? <AudioLines size={19} /> : <FileText size={19} />}
              <span className="step-number">{index + 1}</span><span className="step-name">{steps[stepIndex]}</span>
            </button>
          ))}
        </nav>
        <nav className="secondary-nav" aria-label="Application">
          {([{ step: 2, icon: Settings2 }, { step: 0, icon: ShieldCheck }, { step: 5, icon: Info }]).map(({ step, icon: Icon }) => (
            <button key={step} type="button" className={activeStep === step ? "step is-active" : "step"}
              aria-current={activeStep === step ? "page" : undefined} disabled={booting} onClick={() => navigateToStep(step)}>
              <Icon size={17} />{steps[step]}
            </button>
          ))}
        </nav>

        <div className="engine-box">
          <span className={engine?.can_run ? "dot ok" : "dot warn"} />
          <div>
            <strong>{engine?.can_run ? "Moteur prêt" : "Moteur à vérifier"}</strong>
            <p>{transcription.running ? "Transcription en cours" : selectedModelReady ? "Transcription sur cet ordinateur" : "Modèle à télécharger"}</p>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Microwest Whisper</p>
            <h1>{booting ? "Bienvenue" : steps[activeStep]}</h1>
          </div>
          <div className="status-area">
            <div className="status-strip">
              <StatusPill ok={licenseOk} label={license?.state.development_mode === true ? "Mode développement" : licenseOk ? "Licence active" : "Licence requise"} />
              <button className="update-button" type="button" disabled={updateBusy || transcription.running || outputBusy || loading || changeBusy || hasSegmentEdits} onClick={checkForUpdates}>
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
          <div className="notice error" role="alert">
            <CircleAlert size={18} />
            <span>{error}</span>
            <button className="notice-dismiss" type="button" aria-label="Fermer le message d’erreur" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}

        {activeScreen}
        {pendingChange && <UnsavedChangesDialog error={error} busy={changeBusy} onStay={() => setPendingChange(null)}
          onDiscard={() => void runChange(pendingChange)} onSave={() => void runChange(pendingChange, true)} /> }
      </section>
    </main>
  );
}

export default App;
