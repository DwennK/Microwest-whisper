import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import {
  Check,
  CircleAlert,
  CircleStop,
  Clipboard,
  Clock3,
  Cpu,
  Download,
  FileAudio,
  FileText,
  FolderOpen,
  HardDrive,
  History,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Subtitles,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  AppDiagnostics,
  EngineStatus,
  HistoryRecord,
  LicenseCheck,
  LicenseSnapshot,
  ModelDownloadEvent,
  ModelInventory,
  OutputFile,
  TranscriptSegment,
  TranscriptionEvent,
  TranscriptionRequest,
} from "./types";

const steps = ["Licence", "Audio", "Réglages", "Progression", "Résultats", "À propos"] as const;
const navSteps = ["Audio", "Réglages", "Progression", "Résultats", "À propos"] as const;
const audioExtensions = ["m4a", "mp3", "mp4", "mpeg", "mpga", "wav", "webm", "flac", "ogg"];

const defaultRequest: Omit<TranscriptionRequest, "audio_path" | "output_dir"> = {
  model: "large-v3-turbo-q8_0",
  language: "fr",
  audio_filter: "loudnorm",
  threads: 0,
  device: "auto",
  trim_silence: false,
  force: false,
};

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
  const [license, setLicense] = useState<LicenseSnapshot | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState("");
  const [audioPath, setAudioPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [workDir, setWorkDir] = useState("");
  const [settings, setSettings] = useState(defaultRequest);
  const [modelInventory, setModelInventory] = useState<ModelInventory | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [modelMessage, setModelMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState("En attente");
  const [progress, setProgress] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [selectionOutputs, setSelectionOutputs] = useState<OutputFile[]>([]);
  const [preview, setPreview] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [selectedSegments, setSelectedSegments] = useState<number[]>([]);
  const [segmentSearch, setSegmentSearch] = useState("");
  const [focusedSegment, setFocusedSegment] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState<"text" | "srt">("text");
  const [resultMessage, setResultMessage] = useState("");
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateMessage, setUpdateMessage] = useState("");
  const [error, setError] = useState("");

  const licenseOk = Boolean(license?.cached_valid);
  const selectedModel = modelInventory?.models.find((model) => model.id === settings.model);
  const selectedModelReady = Boolean(selectedModel?.installed);
  const canStart = Boolean(engine?.can_run && selectedModelReady && licenseOk && audioPath && outputDir && !running && !modelBusy);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenModel: (() => void) | undefined;

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
        setModelInventory(modelState);
        setOutputDir(engineStatus.default_output_dir);
        setWorkDir(engineStatus.default_work_dir);
        setLicense(licenseState);
        setLicenseKey(String(licenseState.state.license_key ?? ""));
        await refreshHistory(engineStatus.default_output_dir);
        const validation = await invoke<LicenseCheck>("validate_license", { forceOnline: false });
        applyLicenseCheck(validation);
      } catch (bootError) {
        setError(String(bootError));
      }
    };

    boot();
    listen<TranscriptionEvent>("transcription-event", (event) => handleEngineEvent(event.payload)).then((dispose) => {
      unlisten = dispose;
    });
    listen<ModelDownloadEvent>("model-download-event", (event) => handleModelDownloadEvent(event.payload)).then((dispose) => {
      unlistenModel = dispose;
    });

    return () => {
      unlisten?.();
      unlistenModel?.();
    };
  }, []);

  useEffect(() => {
    if (!running || !startedAt) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  useEffect(() => {
    if (!audioPath || !outputDir) return;
    refreshOutputs(audioPath, outputDir);
  }, [audioPath, outputDir]);

  const quickOutputs = useMemo(
    () =>
      outputs.filter((item) =>
        [".transcript.docx", ".transcript.md", ".segments.srt"].some((suffix) => item.path.endsWith(suffix)),
      ),
    [outputs],
  );

  const filteredSegments = useMemo(() => {
    const query = segmentSearch.trim().toLocaleLowerCase();
    if (!query) return segments.map((segment, index) => ({ segment, index }));
    return segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.text.toLocaleLowerCase().includes(query));
  }, [segments, segmentSearch]);

  const selectedEditableSegments = useMemo(
    () => selectedSegments.map((index) => segments[index]).filter(Boolean),
    [segments, selectedSegments],
  );

  const selectedText = useMemo(
    () => selectedEditableSegments.map((segment) => segment.text.trim()).filter(Boolean).join("\n\n"),
    [selectedEditableSegments],
  );

  const srtPreview = useMemo(() => buildSrt(selectedEditableSegments), [selectedEditableSegments]);

  async function refreshHistory(dir = outputDir) {
    if (!dir) return;
    const records = await invoke<HistoryRecord[]>("read_history", { outputDir: dir });
    setHistory(records);
  }

  async function refreshOutputs(audio = audioPath, dir = outputDir) {
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
  }

  function applyLicenseCheck(result: LicenseCheck) {
    setLicense({
      state: result.state,
      status_text: result.message,
      cached_valid: result.ok,
    });
    setLicenseMessage(result.message);
    setLicenseKey(String(result.state.license_key ?? licenseKey));
  }

  function handleEngineEvent(event: TranscriptionEvent) {
    if (event.kind === "started") {
      setRunning(true);
      setProgress(5);
      setStage(event.stage);
      const now = Date.now();
      setStartedAt(now);
      setElapsedSeconds(0);
      setLogLines([event.line]);
      setActiveStep(3);
      return;
    }

    if (event.kind === "completed") {
      setRunning(false);
      setProgress(100);
      setStage("Terminé");
      setStartedAt(null);
      setLogLines((lines) => [...lines, event.line]);
      void refreshOutputs();
      void refreshHistory();
      setActiveStep(4);
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
      setError(event.line);
      setStage("Échec");
      setLogLines((lines) => [...lines, event.line]);
      return;
    }

    if (event.progress > 0) {
      setProgress((current) => Math.max(current, event.progress));
      setStage(event.stage);
    }
    setLogLines((lines) => [...lines.slice(-250), `[${event.stream}] ${event.line}`]);
  }

  function handleModelDownloadEvent(event: ModelDownloadEvent) {
    setModelProgress(event.progress);
    setModelMessage(event.line);
    if (event.kind === "completed") {
      setModelBusy(false);
    }
  }

  async function refreshEngineAndModels() {
    const [engineStatus, modelState] = await Promise.all([
      invoke<EngineStatus>("engine_status"),
      invoke<ModelInventory>("model_status"),
    ]);
    setEngine(engineStatus);
    setModelInventory(modelState);
  }

  async function chooseAudio() {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Audio", extensions: audioExtensions }],
    });
    if (typeof selected === "string") {
      setAudioPath(selected);
      setActiveStep(2);
    }
  }

  async function chooseOutputDir() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setOutputDir(selected);
      await refreshHistory(selected);
    }
  }

  async function activateLicense() {
    setLicenseBusy(true);
    setError("");
    try {
      const result = await invoke<LicenseCheck>("activate_license", { licenseKey });
      applyLicenseCheck(result);
      if (result.ok) setActiveStep(1);
    } catch (activationError) {
      setError(String(activationError));
    } finally {
      setLicenseBusy(false);
    }
  }

  async function validateLicenseOnline() {
    setLicenseBusy(true);
    setError("");
    try {
      const result = await invoke<LicenseCheck>("validate_license", { forceOnline: true });
      applyLicenseCheck(result);
    } catch (validationError) {
      setError(String(validationError));
    } finally {
      setLicenseBusy(false);
    }
  }

  async function downloadSelectedModel() {
    setModelBusy(true);
    setModelProgress(0);
    setModelMessage("Préparation du téléchargement...");
    setError("");
    try {
      const updated = await invoke<ModelInventory>("download_model", { model: settings.model });
      setModelInventory(updated);
      await refreshEngineAndModels();
    } catch (downloadError) {
      setError(String(downloadError));
    } finally {
      setModelBusy(false);
    }
  }

  async function deleteModels() {
    setModelBusy(true);
    setModelProgress(0);
    setModelMessage("");
    setError("");
    try {
      const updated = await invoke<ModelInventory>("delete_downloaded_models");
      setModelInventory(updated);
      await refreshEngineAndModels();
    } catch (deleteError) {
      setError(String(deleteError));
    } finally {
      setModelBusy(false);
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
    setProgress(0);
    setStage("Préparation");
    setLogLines([]);
    setShowLogs(false);
    const request: TranscriptionRequest = {
      ...settings,
      audio_path: audioPath,
      output_dir: outputDir,
      work_dir: workDir,
    };
    await invoke("start_transcription", { request });
  }

  async function cancelTranscription() {
    if (!running) return;
    try {
      await invoke("cancel_transcription");
    } catch (cancelError) {
      setError(String(cancelError));
    }
  }

  function updateSegment(index: number, text: string) {
    setSegments((current) => current.map((segment, itemIndex) => (itemIndex === index ? { ...segment, text } : segment)));
  }

  function toggleSegment(index: number) {
    setSelectedSegments((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort((left, right) => left - right),
    );
  }

  function setAllVisibleSegments(selected: boolean) {
    const visible = filteredSegments.map(({ index }) => index);
    setSelectedSegments((current) => {
      if (!selected) return current.filter((index) => !visible.includes(index));
      return Array.from(new Set([...current, ...visible])).sort((left, right) => left - right);
    });
  }

  async function copySelectedText() {
    const text = previewMode === "srt" ? srtPreview : selectedText || preview;
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setResultMessage("Contenu copié.");
    } catch (copyError) {
      setError(`Copie impossible: ${String(copyError)}`);
    }
  }

  async function exportSelectedSegments() {
    if (!audioPath || !outputDir || selectedEditableSegments.length === 0) return;
    setError("");
    setResultMessage("");
    try {
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
    } catch (exportError) {
      setError(String(exportError));
    }
  }

  function focusSegment(index: number) {
    setFocusedSegment(index);
    window.setTimeout(() => document.getElementById(`segment-${index}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
  }

  const estimatedRemaining =
    running && progress > 10 && progress < 100
      ? Math.max(0, Math.round((elapsedSeconds / progress) * (100 - progress)))
      : null;

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
          {navSteps.map((step, index) => {
            const stepIndex = index + 1;
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

        {activeStep === 0 && (
          <section className={licenseOk ? "screen two-column license-compact" : "screen two-column"}>
            <div className="primary-panel">
              <SectionTitle icon={<ShieldCheck size={20} />} title="Licence IA Swiss" />
              <p className="muted">{licenseOk ? "Licence active." : license?.status_text ?? "Validation de la licence au lancement..."}</p>
              {!licenseOk && (
                <>
              <label className="field">
                <span>Clé de licence</span>
                <input
                  value={licenseKey}
                  placeholder="MW-XXXXX-XXXXX-XXXXX-XXXXX"
                  onChange={(event) => setLicenseKey(event.target.value)}
                />
              </label>
              <div className="action-row">
                <button className="primary" type="button" disabled={licenseBusy || !licenseKey.trim()} onClick={activateLicense}>
                  {licenseBusy ? <Loader2 className="spin" size={17} /> : <Check size={17} />}
                  Activer
                </button>
                <button type="button" disabled={licenseBusy || !license?.state?.license_key} onClick={validateLicenseOnline}>
                  <RefreshCw size={17} />
                  Vérifier
                </button>
              </div>
                </>
              )}
              {licenseOk && (
                <div className="action-row">
                  <button type="button" disabled={licenseBusy || !license?.state?.license_key} onClick={validateLicenseOnline}>
                    {licenseBusy ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
                    Revérifier
                  </button>
                  <button className="primary" type="button" onClick={() => setActiveStep(1)}>
                    <FileAudio size={17} />
                    Continuer
                  </button>
                </div>
              )}
              {licenseMessage && <p className="inline-status">{licenseMessage}</p>}
            </div>
            <div className="secondary-panel">
              <SectionTitle icon={<Sparkles size={20} />} title="Contrat licence" />
              <dl className="details">
                <div>
                  <dt>API</dt>
                  <dd>https://iaswiss.com/api/licenses</dd>
                </div>
                <div>
                  <dt>Abonnement</dt>
                  <dd>{String(license?.state?.subscription_status ?? "non vérifié")}</dd>
                </div>
                <div>
                  <dt>Validité locale</dt>
                  <dd>{String(license?.state?.valid_until ?? "aucune")}</dd>
                </div>
                <div>
                  <dt>Etat local</dt>
                  <dd>{licenseOk ? "valide" : "à vérifier"}</dd>
                </div>
              </dl>
            </div>
          </section>
        )}

        {activeStep === 1 && (
          <section className="screen two-column">
            <div className="primary-panel">
              <SectionTitle icon={<FileAudio size={20} />} title="Fichier audio" />
              <div className="file-target">
                <strong>{audioPath ? fileName(audioPath) : "Aucun fichier sélectionné"}</strong>
                <span>{audioPath || "Formats: m4a, mp3, mp4, wav, webm, flac, ogg"}</span>
              </div>
              <div className="action-row">
                <button className="primary" type="button" onClick={chooseAudio}>
                  <FileAudio size={17} />
                  Choisir audio
                </button>
                {audioPath && (
                  <button type="button" onClick={() => revealItemInDir(audioPath)}>
                    <FolderOpen size={17} />
                    Afficher
                  </button>
                )}
              </div>
            </div>
            <div className="secondary-panel">
              <SectionTitle icon={<FolderOpen size={20} />} title="Dossier output" />
              <div className="file-target compact">
                <strong>{outputDir ? fileName(outputDir) : "Sortie"}</strong>
                <span>{outputDir || engine?.default_output_dir}</span>
              </div>
              <button type="button" onClick={chooseOutputDir}>
                <FolderOpen size={17} />
                Changer le dossier
              </button>
            </div>
          </section>
        )}

        {activeStep === 2 && (
          <section className="screen settings-grid">
            <div className="primary-panel">
              <SectionTitle icon={<Settings2 size={20} />} title="Paramètres transcription" />
              <div className="form-grid">
                <Select label="Modèle" value={settings.model} onChange={(model) => setSettings({ ...settings, model })} options={["large-v3-turbo-q8_0", "large-v3-turbo-q5_0"]} />
                <Select label="Langue" value={settings.language} onChange={(language) => setSettings({ ...settings, language })} options={["fr", "en", "auto"]} />
                <Select label="Backend" value="whisper.cpp" onChange={() => undefined} options={["whisper.cpp"]} />
                <Select label="Filtre audio" value={settings.audio_filter} onChange={(audio_filter) => setSettings({ ...settings, audio_filter })} options={["loudnorm", "voice-clean", "none"]} />
                <NumberField label="Threads CPU" value={settings.threads} min={0} max={64} onChange={(threads) => setSettings({ ...settings, threads })} />
                <Select label="Device" value={settings.device} onChange={(device) => setSettings({ ...settings, device })} options={["auto", "cpu"]} />
              </div>
              <div className="toggle-grid">
                <Toggle label="Nettoyer silences" checked={settings.trim_silence} onChange={(trim_silence) => setSettings({ ...settings, trim_silence })} />
                <Toggle label="Forcer recalcul" checked={settings.force} onChange={(force) => setSettings({ ...settings, force })} />
              </div>
            </div>

            <div className="secondary-panel">
              <SectionTitle icon={<History size={20} />} title="Moteur local" />
              <dl className="details engine-details">
                <div>
                  <dt>Backend</dt>
                  <dd>{engine?.backend ?? "whisper.cpp"}</dd>
                </div>
                <div>
                  <dt>Plateforme</dt>
                  <dd>{engine ? `${engine.platform} · ${engine.architecture}` : "détection..."}</dd>
                </div>
                <div>
                  <dt>whisper-cli</dt>
                  <dd>{engine?.whisper_cli || "non détecté"}</dd>
                </div>
                <div>
                  <dt>FFmpeg</dt>
                  <dd>{engine?.ffmpeg || "non détecté"}</dd>
                </div>
                <div>
                  <dt>Modèle</dt>
                  <dd>{engine?.model_path || "non détecté"}</dd>
                </div>
                <div>
                  <dt>Modèle sélectionné</dt>
                  <dd>
                    {selectedModel
                      ? `${selectedModel.label} · ${selectedModel.installed ? `installé (${selectedModel.source})` : `à télécharger (${selectedModel.size_label})`}`
                      : "non détecté"}
                  </dd>
                </div>
                <div>
                  <dt>Dossier modèles</dt>
                  <dd>{modelInventory?.models_dir || "non détecté"}</dd>
                </div>
              </dl>
              <div className="model-actions">
                <button className="primary" type="button" disabled={modelBusy || selectedModel?.installed} onClick={downloadSelectedModel}>
                  {modelBusy ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
                  Télécharger
                </button>
                <button type="button" disabled={modelBusy || !modelInventory?.total_downloaded_bytes} onClick={deleteModels}>
                  <Trash2 size={17} />
                  Supprimer modèles
                </button>
                <button type="button" disabled={!modelInventory?.models_dir} onClick={() => modelInventory?.models_dir && openPath(modelInventory.models_dir)}>
                  <FolderOpen size={17} />
                  Dossier
                </button>
              </div>
              {(modelBusy || modelMessage) && (
                <div className="model-progress">
                  <div className="progress-bar compact" aria-label="Progression téléchargement modèle">
                    <span style={{ width: `${modelProgress}%` }} />
                  </div>
                  <p>{modelMessage}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {activeStep === 3 && (
          <section className="screen progress-screen">
            <div className="primary-panel">
              <SectionTitle icon={<Play size={20} />} title="Exécution" />
              <div className="progress-head">
                <div>
                  <strong>{stage}</strong>
                  <span>
                    {running
                      ? `En cours · ${formatDuration(elapsedSeconds)} écoulé${estimatedRemaining !== null ? ` · ~${formatDuration(estimatedRemaining)} restantes` : ""}`
                      : "Prêt à lancer"}
                  </span>
                </div>
                <div className="action-row compact-actions">
                  <button className="primary" type="button" disabled={!canStart} onClick={startTranscription}>
                    {running ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
                    Lancer
                  </button>
                  <button type="button" disabled={!running} onClick={cancelTranscription}>
                    <CircleStop size={17} />
                    Annuler
                  </button>
                </div>
              </div>
              <div className="progress-bar" aria-label="Progression transcription">
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="stage-grid">
                {stageSteps.map((item) => (
                  <div className={item.stage === stage ? "stage-card is-current" : progress >= item.min ? "stage-card is-done" : "stage-card"} key={item.stage}>
                    <span />
                    <strong>{item.stage}</strong>
                  </div>
                ))}
              </div>
              <button className="log-toggle" type="button" onClick={() => setShowLogs((value) => !value)}>
                <Info size={16} />
                {showLogs ? "Masquer les détails" : "Détails techniques"}
              </button>
              {showLogs && <pre className="log-view">{logLines.length ? logLines.join("\n") : "Le journal apparaîtra ici."}</pre>}
            </div>
          </section>
        )}

        {activeStep === 4 && (
          <section className="screen results-grid">
            <div className="primary-panel">
              <SectionTitle icon={<Search size={20} />} title="Segments" />
              <div className="results-toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input value={segmentSearch} placeholder="Rechercher dans la transcription" onChange={(event) => setSegmentSearch(event.target.value)} />
                </label>
                <button type="button" disabled={filteredSegments.length === 0} onClick={() => setAllVisibleSegments(true)}>
                  <Check size={16} />
                  Tout sélectionner
                </button>
                <button type="button" disabled={filteredSegments.length === 0} onClick={() => setAllVisibleSegments(false)}>
                  <CircleStop size={16} />
                  Désélectionner
                </button>
              </div>
              <div className="segment-summary">
                <strong>{selectedEditableSegments.length}</strong>
                <span>segment(s) sélectionné(s) sur {segments.length}</span>
              </div>
              <div className="segment-list">
                {filteredSegments.length === 0 && <p className="muted">Aucun segment disponible pour ce fichier.</p>}
                {filteredSegments.map(({ segment, index }) => (
                  <article id={`segment-${index}`} className={focusedSegment === index ? "segment-row is-focused" : "segment-row"} key={`${index}-${segment.start}`}>
                    <label className="segment-check" aria-label={`Sélectionner le segment ${index + 1}`}>
                      <input type="checkbox" checked={selectedSegments.includes(index)} onChange={() => toggleSegment(index)} />
                      <span />
                    </label>
                    <button className="timestamp-button" type="button" onClick={() => focusSegment(index)}>
                      {formatSegmentTimestamp(segment.start)}
                    </button>
                    <textarea value={segment.text} onChange={(event) => updateSegment(index, event.target.value)} />
                  </article>
                ))}
              </div>
            </div>
            <div className="secondary-panel">
              <SectionTitle icon={<FileText size={20} />} title="Exports complets" />
              <div className="output-list">
                {outputs.map((item) => (
                  <div className={item.exists ? "output-row is-ready" : "output-row"} key={item.path}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.path}</span>
                    </div>
                    <button type="button" disabled={!item.exists} onClick={() => openPath(item.path)}>
                      <FileText size={16} />
                      Ouvrir
                    </button>
                  </div>
                ))}
              </div>
              <h2>Export sélection</h2>
              <div className="selection-actions">
                <button className="primary" type="button" disabled={selectedEditableSegments.length === 0} onClick={exportSelectedSegments}>
                  <Save size={16} />
                  Exporter sélection
                </button>
                <button type="button" disabled={!selectedText && !preview} onClick={copySelectedText}>
                  <Clipboard size={16} />
                  Copier
                </button>
              </div>
              {resultMessage && <p className="inline-status">{resultMessage}</p>}
              {selectionOutputs.length > 0 && (
                <div className="quick-list selection-output-list">
                  {selectionOutputs.map((item) => (
                    <button key={item.path} type="button" disabled={!item.exists} onClick={() => openPath(item.path)}>
                      <FileText size={16} />
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
              <h2>Accès rapide</h2>
              <div className="quick-list">
                {quickOutputs.length === 0 && <p className="muted">Aucun export prioritaire disponible.</p>}
                {quickOutputs.map((item) => (
                  <button key={item.path} type="button" disabled={!item.exists} onClick={() => openPath(item.path)}>
                    <FileText size={16} />
                    {item.label}
                  </button>
                ))}
              </div>
              <h2>Historique</h2>
              <div className="history-list">
                {history.length === 0 && <p className="muted">Aucun historique dans ce dossier.</p>}
                {history.slice(0, 6).map((record) => (
                  <button
                    key={`${record.created_at}-${record.stem}`}
                    type="button"
                    onClick={() => {
                      setAudioPath(record.source_audio);
                      void refreshOutputs(record.source_audio, outputDir);
                    }}
                  >
                    <span>{fileName(record.source_audio)}</span>
                    <small>{record.model} · {formatDuration(record.duration_seconds)}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="preview-panel">
              <div className="preview-head">
                <SectionTitle icon={previewMode === "srt" ? <Subtitles size={20} /> : <FileText size={20} />} title={previewMode === "srt" ? "Aperçu SRT" : "Aperçu texte"} />
                <div className="segmented-control">
                  <button className={previewMode === "text" ? "is-active" : ""} type="button" onClick={() => setPreviewMode("text")}>
                    Texte
                  </button>
                  <button className={previewMode === "srt" ? "is-active" : ""} type="button" onClick={() => setPreviewMode("srt")}>
                    SRT
                  </button>
                </div>
              </div>
              <pre>{previewMode === "srt" ? srtPreview || "Sélectionnez au moins un segment pour générer l'aperçu SRT." : selectedText || preview || "Aucun aperçu Markdown ou texte disponible."}</pre>
            </div>
          </section>
        )}

        {activeStep === 5 && (
          <section className="screen two-column">
            <div className="primary-panel">
              <SectionTitle icon={<Info size={20} />} title="À propos" />
              <dl className="details">
                <div>
                  <dt>Application</dt>
                  <dd>{appInfo ? `${appInfo.name} ${appInfo.version}` : "Microwest Whisper"}</dd>
                </div>
                <div>
                  <dt>Backend</dt>
                  <dd>{appInfo?.backend ?? engine?.backend ?? "whisper.cpp"}</dd>
                </div>
                <div>
                  <dt>Modèle actif</dt>
                  <dd>
                    {selectedModel
                      ? `${selectedModel.label} · ${selectedModel.installed ? selectedModel.source : "non installé"}`
                      : engine?.default_model ?? "non détecté"}
                  </dd>
                </div>
                <div>
                  <dt>Plateforme</dt>
                  <dd>{appInfo ? `${appInfo.platform} · ${appInfo.architecture}` : "détection..."}</dd>
                </div>
                <div>
                  <dt>Licence</dt>
                  <dd>{licenseOk ? "active" : license?.status_text ?? "à vérifier"}</dd>
                </div>
                <div>
                  <dt>Updater</dt>
                  <dd>{appInfo?.update_endpoint ?? "GitHub Releases"}</dd>
                </div>
                <div>
                  <dt>Contrôle release</dt>
                  <dd>Signatures Tauri + SHA256SUMS.txt sur GitHub Releases</dd>
                </div>
              </dl>
            </div>
            <div className="secondary-panel">
              <SectionTitle icon={<HardDrive size={20} />} title="Chemins locaux" />
              <dl className="details engine-details">
                <div>
                  <dt>Ressources moteur</dt>
                  <dd>{appInfo?.engine_root ?? engine?.engine_root ?? "non détecté"}</dd>
                </div>
                <div>
                  <dt>Modèles</dt>
                  <dd>{appInfo?.model_dir ?? modelInventory?.models_dir ?? "non détecté"}</dd>
                </div>
                <div>
                  <dt>Espace modèles</dt>
                  <dd>{formatBytes(modelInventory?.total_downloaded_bytes ?? 0)}</dd>
                </div>
                <div>
                  <dt>Sorties</dt>
                  <dd>{appInfo?.default_output_dir ?? outputDir}</dd>
                </div>
                <div>
                  <dt>Travail temporaire</dt>
                  <dd>{appInfo?.default_work_dir ?? workDir}</dd>
                </div>
                <div>
                  <dt>Licence locale</dt>
                  <dd>{appInfo?.license_state_path ?? "non détecté"}</dd>
                </div>
              </dl>
              <div className="model-actions">
                <button type="button" disabled={!modelInventory?.models_dir} onClick={() => modelInventory?.models_dir && openPath(modelInventory.models_dir)}>
                  <HardDrive size={17} />
                  Modèles
                </button>
                <button type="button" disabled={!outputDir} onClick={() => outputDir && openPath(outputDir)}>
                  <FolderOpen size={17} />
                  Sorties
                </button>
                <button type="button" disabled={!engine?.engine_root} onClick={() => engine?.engine_root && openPath(engine.engine_root)}>
                  <Cpu size={17} />
                  Moteur
                </button>
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="section-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "status-pill ok" : "status-pill warn"}>
      <span />
      {label}
    </span>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span />
      {label}
    </label>
  );
}

function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatDuration(value: number | null) {
  if (!value) return "durée inconnue";
  const total = Math.round(value);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSegmentTimestamp(value: number) {
  const total = Math.max(0, Math.floor(value));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSrtTimestamp(value: number) {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function buildSrt(segments: TranscriptSegment[]) {
  return segments
    .map((segment, index) => `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${segment.text.trim()}`)
    .join("\n\n");
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export default App;
