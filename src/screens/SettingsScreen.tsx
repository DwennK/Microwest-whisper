import { Download, FolderOpen, History, Loader2, Play, Settings2, Trash2 } from "lucide-react";
import { NumberField, SectionTitle, Select, Toggle } from "../components/ui";
import type { EngineStatus, ModelInfo, ModelInventory, TranscriptionRequest } from "../types";

type TranscriptionSettings = Omit<TranscriptionRequest, "audio_path" | "output_dir">;

interface SettingsScreenProps {
  settings: TranscriptionSettings;
  engine: EngineStatus | null;
  modelInventory: ModelInventory | null;
  selectedModel: ModelInfo | undefined;
  selectedModelReady: boolean;
  modelBusy: boolean;
  modelProgress: number;
  modelMessage: string;
  canStart: boolean;
  startDisabledReason: string;
  onSettingsChange: (settings: TranscriptionSettings) => void;
  onDownloadModel: () => void;
  onDeleteModels: () => void;
  onOpenPath: (path: string) => void;
  onStart: () => void;
}

export function SettingsScreen({
  settings,
  engine,
  modelInventory,
  selectedModel,
  selectedModelReady,
  modelBusy,
  modelProgress,
  modelMessage,
  canStart,
  startDisabledReason,
  onSettingsChange,
  onDownloadModel,
  onDeleteModels,
  onOpenPath,
  onStart,
}: SettingsScreenProps) {
  return (
    <section className="screen settings-grid">
      <div className="primary-panel">
        <SectionTitle icon={<Settings2 size={20} />} title="Paramètres transcription" />
        <div className="form-grid">
          <Select label="Modèle" value={settings.model} onChange={(model) => onSettingsChange({ ...settings, model })} options={["large-v3-turbo-q8_0", "large-v3-turbo-q5_0"]} />
          <Select
            label="Langue"
            value={settings.language}
            onChange={(language) => onSettingsChange({ ...settings, language })}
            options={["auto", "fr", "en", "de", "it", "es", "pt", "nl", "pl", "uk", "ar", "zh", "ja", "ko"]}
          />
          <Select label="Backend" value="whisper.cpp" disabled onChange={() => undefined} options={["whisper.cpp"]} />
          <Select label="Filtre audio" value={settings.audio_filter} onChange={(audio_filter) => onSettingsChange({ ...settings, audio_filter })} options={["loudnorm", "voice-clean", "none"]} />
          <NumberField label="Threads CPU (0 = auto)" value={settings.threads} min={0} max={64} onChange={(threads) => onSettingsChange({ ...settings, threads })} />
          <Select label="Device" value={settings.device} onChange={(device) => onSettingsChange({ ...settings, device })} options={["auto", "cpu"]} />
        </div>
        <div className="toggle-grid">
          <Toggle label="Nettoyer silences" checked={settings.trim_silence} onChange={(trim_silence) => onSettingsChange({ ...settings, trim_silence })} />
          <Toggle label="Forcer recalcul" checked={settings.force} onChange={(force) => onSettingsChange({ ...settings, force })} />
        </div>
        <div className="action-row">
          <button className="primary" type="button" disabled={!canStart} onClick={onStart}>
            <Play size={17} />
            Lancer la transcription
          </button>
          {!canStart && startDisabledReason && <p className="inline-status">{startDisabledReason}</p>}
        </div>
      </div>

      <div className="secondary-panel">
        <SectionTitle icon={<History size={20} />} title="Moteur local" />
        {!selectedModelReady && (
          <div className="notice warning">
            <Download size={18} />
            <span>Téléchargez le modèle sélectionné pour commencer.</span>
          </div>
        )}
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
          <button className="primary" type="button" disabled={modelBusy || selectedModel?.installed} onClick={onDownloadModel}>
            {modelBusy ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
            Télécharger
          </button>
          <button type="button" disabled={modelBusy || !modelInventory?.total_downloaded_bytes} onClick={onDeleteModels}>
            <Trash2 size={17} />
            Supprimer modèles
          </button>
          <button type="button" disabled={!modelInventory?.models_dir} onClick={() => modelInventory?.models_dir && onOpenPath(modelInventory.models_dir)}>
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
  );
}
