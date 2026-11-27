import { message, t, useInterfaceLanguage } from "./lib/i18n";
import appIcon from "../assets/app-icon-small.png";
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
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
import { pendingFile, useAudioQueue } from "./hooks/useAudioQueue";
import { fileName } from "./lib/format";
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
  const interfaceLanguage = useInterfaceLanguage();
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
  const queue = useAudioQueue();

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
    if (!queue.active.current) setActiveStep(3);
  }, [queue.active]);

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

  const processing = transcription.running || queue.running;
  const queueDone = queue.items.length > 0 && queue.items.every(item => item.status === "completed");
  const currentQueueIndex = queue.items.findIndex(item => item.status === "running");
  const canStart = Boolean(engine?.can_run && selectedModelReady && licenseOk && audioPath && outputDir && !processing && !queueDone && !modelBusy && !loading && !outputBusy && !booting && eventsReady && !changeBusy);
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
    if (processing) return "Transcription déjà en cours.";
    if (queueDone) return "Transcription terminée";
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

  const controlsLocked = processing || outputBusy || changeBusy || loading;

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

  function selectFiles(paths: string[], append: boolean) {
    if (controlsLocked || queue.active.current || pendingChange) return;
    const files = append ? [...(queue.items.length ? queue.items : audioPath ? [pendingFile(audioPath)] : [])] : [];
    const initialLength = files.length;
    const rejected: string[] = [];
    const identity = (path: string) => engine?.platform === "windows" ? path.replaceAll("/", "\\").toLowerCase() : path;
    const seen = new Set(files.map(item => identity(item.path)));
    for (const path of paths) {
      const name = fileName(path);
      if (!name.includes(".") || !audioExtensions.includes(name.slice(name.lastIndexOf(".") + 1).toLowerCase())) {
        rejected.push(name);
        continue;
      }
      if (seen.has(identity(path))) continue;
      seen.add(identity(path));
      files.push(pendingFile(path));
    }
    const warning = rejected.length ? `Format audio non pris en charge: ${rejected.join(", ")}` : "";
    if (files.length === initialLength) {
      if (warning) setError(warning);
      return;
    }
    if (files[0].path === audioPath || (append && initialLength > 0)) {
      queue.setItems(files.length > 1 ? files : []);
      setError(warning);
      return;
    }
    requestChange(async () => {
      queue.setItems(files.length > 1 ? files : []);
      await replaceSource(files[0].path, outputDir);
      if (warning) setError(warning);
    });
  }

  const dropFiles = useRef((_: string[]) => {});
  useEffect(() => {
    dropFiles.current = paths => { if (activeStep === 1 && !booting) selectFiles(paths, true); };
  });
  useEffect(() => {
    let disposed = false;
    const registration = listen<{ paths: string[] }>("tauri://drag-drop", event => {
      if (!disposed) dropFiles.current(event.payload.paths);
    }, { target: { kind: "Webview", label: "main" } });
    void registration.catch(error => { if (!disposed) setError(String(error)); });
    return () => { disposed = true; void registration.then(stop => stop(), () => {}); };
  }, []);

  async function chooseAudio(append = false) {
    if (controlsLocked) return;
    try {
      const selected = await openDialog({ multiple: true, filters: [{ name: t("Audio"), extensions: audioExtensions }] });
      if (selected) selectFiles(typeof selected === "string" ? [selected] : selected, append);
    } catch (error) { setError(`Sélection impossible : ${String(error)}`); }
  }

  async function chooseOutputDir() {
    if (controlsLocked) return;
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string" && selected !== outputDir) requestChange(async () => {
        queue.setItems(current => current.map(item => pendingFile(item.path)));
        await replaceSource(audioPath, selected);
      });
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
    if (processing || modelBusy) return;
    setError("");
    try {
      await downloadSelectedModel();
      await refreshEngineAndModels();
    } catch (downloadError) {
      setError(String(downloadError));
    }
  }

  async function handleDeleteModels() {
    if (processing || modelBusy) return;
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
      if (!queue.items.length) return transcription.startTranscription(request);
      setActiveStep(3);
      void queue.run(request, transcription.runQueuedFile).then(async () => {
        setActiveStep(1);
        await Promise.all([handleRefreshHistory(outputDir), handleRefreshOutputs(audioPath, outputDir)]);
      });
    });
  }

  async function cancelTranscription() {
    if (queue.active.current) queue.stopRequested.current = true;
    try {
      await transcription.cancelTranscription();
    } catch (cancelError) {
      queue.stopRequested.current = false;
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
      await invoke("open_local_path", { path, outputDir });
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
    if (booting) return <div className="screen loading-state" role="status"><Loader2 className="spin" />{t("Préparation de l’application…")}</div>;
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
          onChooseAudio={() => void chooseAudio()}
          onAddAudio={() => void chooseAudio(true)}
          queue={queue.items}
          onMoveUp={index => queue.setItems(current => {
            const reordered = [...current];
            [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
            return reordered;
          })}
          onRemove={index => requestChange(async () => {
            const remaining = queue.items.filter((_, i) => i !== index);
            queue.setItems(remaining);
            if (queue.items[index].path === audioPath) await replaceSource(remaining[0]?.path ?? "", outputDir);
          })}
          onReview={path => requestChange(async () => {
            await replaceSource(path, outputDir);
            setActiveStep(4);
          })}
          onChooseOutputDir={chooseOutputDir}
          onRevealAudio={handleRevealPath}
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
          interfaceLanguage={interfaceLanguage}
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
          locked={processing || modelBusy}
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
          audioPath={queue.items[currentQueueIndex]?.path ?? audioPath}
          position={currentQueueIndex >= 0 ? `${currentQueueIndex + 1} / ${queue.items.length}` : undefined}
          phase={transcription.phase}
          running={processing}
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
      if (loading) return <div className="screen loading-state" role="status"><Loader2 className="spin" />{t("Chargement de la transcription…")}</div>;
      if (loadError) return <div className="screen"><p role="alert">{message(loadError)}</p><button type="button" onClick={() => void refreshOutputs(audioPath, outputDir)}>{t("Réessayer le chargement")}</button></div>;
      return (
        <ResultsScreen
          key={`${audioPath}|${outputDir}`}
          busy={outputBusy || processing || changeBusy}
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
            if (sourceAudio !== audioPath || dir !== outputDir) requestChange(async () => {
              queue.setItems([]);
              await replaceSource(sourceAudio, dir);
            });
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
            <span>{t("Transcription locale")}</span>
          </div>
        </div>

        <p className="rail-label">{t("Votre espace")}</p>
        <nav className="steps" aria-label={t("Étapes de transcription")}>
          {[1, 3, 4].map((stepIndex, index) => (
            <button key={stepIndex} className={stepIndex === activeStep ? "step is-active" : "step"}
              type="button" aria-current={stepIndex === activeStep ? "step" : undefined}
              disabled={booting} onClick={() => navigateToStep(stepIndex)}>
              {stepIndex === 1 ? <FileAudio size={19} /> : stepIndex === 3 ? <AudioLines size={19} /> : <FileText size={19} />}
              <span className="step-number">{index + 1}</span><span className="step-name">{t(steps[stepIndex])}</span>
            </button>
          ))}
        </nav>
        <nav className="secondary-nav" aria-label={t("Application")}>
          {([{ step: 2, icon: Settings2 }, { step: 0, icon: ShieldCheck }, { step: 5, icon: Info }]).map(({ step, icon: Icon }) => (
            <button key={step} type="button" className={activeStep === step ? "step is-active" : "step"}
              aria-current={activeStep === step ? "page" : undefined} disabled={booting} onClick={() => navigateToStep(step)}>
              <Icon size={17} />{t(steps[step])}
            </button>
          ))}
        </nav>

        <div className="engine-box">
          <span className={engine?.can_run ? "dot ok" : "dot warn"} />
          <div>
            <strong>{engine?.can_run ? t("Moteur prêt") : t("Moteur à vérifier")}</strong>
            <p>{transcription.running ? t("Transcription en cours") : selectedModelReady ? t("Transcription sur cet ordinateur") : t("Modèle à télécharger")}</p>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Microwest Whisper</p>
            <h1>{booting ? t("Bienvenue") : t(steps[activeStep])}</h1>
          </div>
          <div className="status-area">
            <div className="status-strip">
              <StatusPill ok={licenseOk} label={license?.state.development_mode === true ? t("Mode développement") : licenseOk ? t("Licence active") : t("Licence requise")} />
              <button className="update-button" type="button" disabled={updateBusy || processing || outputBusy || loading || changeBusy || hasSegmentEdits} onClick={checkForUpdates}>
                {updateBusy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                {t("Mise à jour")}
              </button>
            </div>
            {updateMessage && (
              <div className="update-inline">
                <span>{message(updateMessage)}</span>
                {updateBusy && updateProgress > 0 && <strong>{updateProgress}%</strong>}
              </div>
            )}
          </div>
        </header>

        {error && (
          <div className="notice error" role="alert">
            <CircleAlert size={18} />
            <span>{message(error)}</span>
            <button className="notice-dismiss" type="button" aria-label={t("Fermer le message d’erreur")} onClick={() => setError("")}>
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
