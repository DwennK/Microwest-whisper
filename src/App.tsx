import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Check,
  CircleAlert,
  Clock3,
  FileAudio,
  FileText,
  FolderOpen,
  History,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  EngineStatus,
  HistoryRecord,
  LicenseCheck,
  LicenseSnapshot,
  OutputFile,
  TranscriptionEvent,
  TranscriptionRequest,
} from "./types";

const steps = ["Licence", "Audio", "Réglages", "Progression", "Résultats"] as const;
const audioExtensions = ["m4a", "mp3", "mp4", "mpeg", "mpga", "wav", "webm", "flac", "ogg"];

const defaultRequest: Omit<TranscriptionRequest, "audio_path" | "output_dir"> = {
  model: "large-v3",
  asr_backend: "auto",
  language: "fr",
  audio_filter: "loudnorm",
  batch_size: 8,
  threads: 0,
  device: "auto",
  compute_type: "auto",
  diarization: false,
  speaker_mode: "auto",
  speakers: 2,
  min_speakers: 2,
  max_speakers: 5,
  trim_silence: false,
  force: false,
  speaker_map: "",
  hf_token: "",
};

function App() {
  const [activeStep, setActiveStep] = useState(0);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [license, setLicense] = useState<LicenseSnapshot | null>(null);
  const [licenseKey, setLicenseKey] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseMessage, setLicenseMessage] = useState("");
  const [audioPath, setAudioPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [workDir, setWorkDir] = useState("");
  const [settings, setSettings] = useState(defaultRequest);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState("En attente");
  const [progress, setProgress] = useState(0);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [preview, setPreview] = useState("");
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [error, setError] = useState("");

  const licenseOk = Boolean(license?.cached_valid);
  const canStart = Boolean(engine?.can_run && licenseOk && audioPath && outputDir && !running);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const boot = async () => {
      try {
        const [engineStatus, licenseState] = await Promise.all([
          invoke<EngineStatus>("engine_status"),
          invoke<LicenseSnapshot>("read_license_state"),
        ]);
        setEngine(engineStatus);
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

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!audioPath || !outputDir) return;
    refreshOutputs(audioPath, outputDir);
  }, [audioPath, outputDir]);

  const quickOutputs = useMemo(
    () =>
      outputs.filter((item) =>
        [".transcript.docx", ".speaker-turns.md", ".speaker-segments.srt"].some((suffix) => item.path.endsWith(suffix)),
      ),
    [outputs],
  );

  async function refreshHistory(dir = outputDir) {
    if (!dir) return;
    const records = await invoke<HistoryRecord[]>("read_history", { outputDir: dir });
    setHistory(records);
  }

  async function refreshOutputs(audio = audioPath, dir = outputDir) {
    if (!audio || !dir) return;
    const files = await invoke<OutputFile[]>("expected_outputs", { audioPath: audio, outputDir: dir });
    setOutputs(files);
    const previewFile = files.find((item) => item.exists && item.path.endsWith(".speaker-turns.md")) ?? files.find((item) => item.exists && item.path.endsWith(".clean.txt"));
    if (previewFile) {
      setPreview(await invoke<string>("read_text_preview", { path: previewFile.path }));
    }
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
      setLogLines([event.line]);
      setActiveStep(3);
      return;
    }

    if (event.kind === "completed") {
      setRunning(false);
      setProgress(100);
      setStage("Terminé");
      setLogLines((lines) => [...lines, event.line]);
      void refreshOutputs();
      void refreshHistory();
      setActiveStep(4);
      return;
    }

    if (event.kind === "failed") {
      setRunning(false);
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

  async function startTranscription() {
    if (!canStart) return;
    setError("");
    const request: TranscriptionRequest = {
      ...settings,
      audio_path: audioPath,
      output_dir: outputDir,
      work_dir: workDir,
      speakers: settings.speaker_mode === "exact" ? settings.speakers : undefined,
      min_speakers: settings.speaker_mode === "range" ? settings.min_speakers : undefined,
      max_speakers: settings.speaker_mode === "range" ? settings.max_speakers : undefined,
      hf_token: settings.hf_token?.trim() || undefined,
      speaker_map: settings.speaker_map?.trim() || undefined,
    };
    await invoke("start_transcription", { request });
  }

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
          {steps.map((step, index) => (
            <button
              key={step}
              className={index === activeStep ? "step is-active" : "step"}
              type="button"
              onClick={() => setActiveStep(index)}
            >
              <span>{index + 1}</span>
              {step}
            </button>
          ))}
        </nav>

        <div className="engine-box">
          <span className={engine?.can_run ? "dot ok" : "dot warn"} />
          <div>
            <strong>{engine?.can_run ? "Moteur prêt" : "Moteur à vérifier"}</strong>
            <p>{engine?.message ?? "Chargement du moteur..."}</p>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Transcription locale</p>
            <h1>{steps[activeStep]}</h1>
          </div>
          <div className="status-strip">
            <StatusPill ok={licenseOk} label={licenseOk ? "Licence active" : "Licence requise"} />
            <StatusPill ok={Boolean(engine?.can_run)} label={engine?.can_run ? "Python détecté" : "Bridge incomplet"} />
          </div>
        </header>

        {error && (
          <div className="notice error">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        )}

        {activeStep === 0 && (
          <section className="screen two-column">
            <div className="primary-panel">
              <SectionTitle icon={<ShieldCheck size={20} />} title="Licence IA Swiss" />
              <p className="muted">{license?.status_text ?? "Validation de la licence au lancement..."}</p>
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
                <Select label="Modèle" value={settings.model} onChange={(model) => setSettings({ ...settings, model })} options={["large-v3", "large-v3-turbo", "medium", "small"]} />
                <Select label="Langue" value={settings.language} onChange={(language) => setSettings({ ...settings, language })} options={["fr", "en", "auto"]} />
                <Select label="Backend" value={settings.asr_backend} onChange={(asr_backend) => setSettings({ ...settings, asr_backend })} options={["auto", "whisperx", "mlx"]} />
                <Select label="Filtre audio" value={settings.audio_filter} onChange={(audio_filter) => setSettings({ ...settings, audio_filter })} options={["loudnorm", "voice-clean", "none"]} />
                <NumberField label="Batch" value={settings.batch_size} min={1} max={32} onChange={(batch_size) => setSettings({ ...settings, batch_size })} />
                <NumberField label="Threads CPU" value={settings.threads} min={0} max={64} onChange={(threads) => setSettings({ ...settings, threads })} />
              </div>
              <div className="toggle-grid">
                <Toggle label="Diarisation" checked={settings.diarization} onChange={(diarization) => setSettings({ ...settings, diarization })} />
                <Toggle label="Nettoyer silences" checked={settings.trim_silence} onChange={(trim_silence) => setSettings({ ...settings, trim_silence })} />
                <Toggle label="Forcer recalcul" checked={settings.force} onChange={(force) => setSettings({ ...settings, force })} />
              </div>
            </div>

            <div className="secondary-panel">
              <SectionTitle icon={<History size={20} />} title="Diarisation et relance" />
              <Select label="Mode locuteurs" value={settings.speaker_mode} onChange={(speaker_mode) => setSettings({ ...settings, speaker_mode: speaker_mode as TranscriptionRequest["speaker_mode"] })} options={["auto", "exact", "range"]} />
              {settings.speaker_mode === "exact" && <NumberField label="Nombre exact" value={settings.speakers ?? 2} min={1} max={24} onChange={(speakers) => setSettings({ ...settings, speakers })} />}
              {settings.speaker_mode === "range" && (
                <div className="form-grid tight">
                  <NumberField label="Min" value={settings.min_speakers ?? 2} min={1} max={24} onChange={(min_speakers) => setSettings({ ...settings, min_speakers })} />
                  <NumberField label="Max" value={settings.max_speakers ?? 5} min={1} max={24} onChange={(max_speakers) => setSettings({ ...settings, max_speakers })} />
                </div>
              )}
              <label className="field">
                <span>Token Hugging Face</span>
                <input type="password" value={settings.hf_token} onChange={(event) => setSettings({ ...settings, hf_token: event.target.value })} placeholder="Seulement pour diarisation" />
              </label>
              <label className="field">
                <span>Renommage locuteurs</span>
                <input value={settings.speaker_map} onChange={(event) => setSettings({ ...settings, speaker_map: event.target.value })} placeholder="SPEAKER_00=Alice,SPEAKER_01=Bruno" />
              </label>
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
                  <span>{running ? "Process Python en cours" : "Prêt à lancer"}</span>
                </div>
                <button className="primary" type="button" disabled={!canStart} onClick={startTranscription}>
                  {running ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
                  Lancer
                </button>
              </div>
              <div className="progress-bar" aria-label="Progression transcription">
                <span style={{ width: `${progress}%` }} />
              </div>
              <pre className="log-view">{logLines.length ? logLines.join("\n") : "Le journal apparaîtra ici."}</pre>
            </div>
          </section>
        )}

        {activeStep === 4 && (
          <section className="screen results-grid">
            <div className="primary-panel">
              <SectionTitle icon={<FileText size={20} />} title="Exports" />
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
            </div>
            <div className="secondary-panel">
              <SectionTitle icon={<Clock3 size={20} />} title="Accès rapide" />
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
              <SectionTitle icon={<FileText size={20} />} title="Aperçu" />
              <pre>{preview || "Aucun aperçu Markdown ou texte disponible."}</pre>
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

export default App;
