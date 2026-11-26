import { interfaceLanguages, languageName, message, t, type useInterfaceLanguage } from "../lib/i18n";
import { Download, FolderOpen, History, Loader2, Play, Settings2, Trash2 } from "lucide-react";
import { NumberField, SectionTitle, Select, Toggle } from "../components/ui";
import { parakeetLabel, audioFilterOptions, audioFilterLabel, type TranscriptionSettings } from "../lib/preferences";
import type { EngineStatus, ModelInfo, ModelInventory } from "../types";

interface SettingsScreenProps {
  interfaceLanguage: ReturnType<typeof useInterfaceLanguage>;
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
  onBack: () => void;
  locked: boolean;
}

export function SettingsScreen({
  interfaceLanguage,
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
  onBack,
  locked,
}: SettingsScreenProps) {
  const { preference, setPreference } = interfaceLanguage;
  return (
    <section className="screen settings-screen">
      <div className="settings-intro"><p>{t("Ces réglages sont conservés pour vos prochaines transcriptions.")}</p><button type="button" onClick={onBack}>{t("Retour au fichier")}</button></div>
      <div className="interface-language">
        <Select label={t("Langue de l’interface")} value={preference} options={["auto", ...interfaceLanguages]}
          optionLabel={code => code === "auto" ? t("Langue du système") : languageName(code)}
          onChange={setPreference} />
      </div>
      {locked && <p className="inline-status" role="status">{t("Les réglages seront disponibles à la fin du traitement en cours.")}</p>}
      <fieldset className="settings-grid plain-fieldset" disabled={locked}>
      <div className="primary-panel">
        <SectionTitle icon={<Settings2 size={20} />} title={t("Paramètres de transcription")} />
        <div className="form-grid">
          <Select label={t("Filtre audio")} value={settings.audio_filter} onChange={(audio_filter) => onSettingsChange({ ...settings, audio_filter })} options={[...audioFilterOptions]} optionLabel={value => t(audioFilterLabel(value))} />
          <NumberField label={t("Cœurs de calcul (0 = automatique)")} value={settings.threads} min={0} max={64} onChange={(threads) => onSettingsChange({ ...settings, threads })} />
        </div>
        <div className="toggle-grid">
          <Toggle label={t("Réduire les silences")} checked={settings.trim_silence} onChange={(trim_silence) => onSettingsChange({ ...settings, trim_silence })} />
          <Toggle label={t("Recalculer les résultats existants")} checked={settings.force} onChange={(force) => onSettingsChange({ ...settings, force })} />
        </div>
        <div className="action-row">
          <button className="primary" type="button" disabled={!canStart} onClick={onStart}>
            <Play size={17} />
            {t("Lancer la transcription")}
          </button>
          {!canStart && startDisabledReason && <p className="inline-status">{message(startDisabledReason)}</p>}
        </div>
      </div>

      <div className="secondary-panel">
        <SectionTitle icon={<History size={20} />} title={t("Moteur local")} />
        {!selectedModelReady && (
          <div className="notice warning">
            <Download size={18} />
            <span>{t("Téléchargez le modèle sélectionné pour commencer.")}</span>
          </div>
        )}
        <dl className="details engine-details">
          <div>
            <dt>{t("Moteur")}</dt>
            <dd>sherpa-onnx</dd>
          </div>
          <div>
            <dt>{t("Plateforme")}</dt>
            <dd>{engine ? `${engine.platform} · ${engine.architecture}` : t("détection...")}</dd>
          </div>
          <div>
            <dt>{t("Modèle sélectionné")}</dt>
            <dd>
              {selectedModel
                ? `${parakeetLabel} · ${selectedModel.installed ? t("installé") : t("à télécharger ({0})", selectedModel.size_label)}`
                : t("non détecté")}
            </dd>
          </div>
          <div>
            <dt>{t("Dossier modèles")}</dt>
            <dd>{modelInventory?.models_dir || t("non détecté")}</dd>
          </div>
        </dl>
        <div className="model-actions">
          <button className="primary" type="button" disabled={modelBusy || selectedModel?.installed} onClick={onDownloadModel}>
            {modelBusy ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
            {t("Télécharger")}
          </button>
          <button type="button" disabled={modelBusy || !modelInventory?.total_downloaded_bytes} onClick={onDeleteModels}>
            <Trash2 size={17} />
            {t("Supprimer modèles")}
          </button>
          <button type="button" disabled={!modelInventory?.models_dir} onClick={() => modelInventory?.models_dir && onOpenPath(modelInventory.models_dir)}>
            <FolderOpen size={17} />
            {t("Dossier")}
          </button>
        </div>
        {(modelBusy || modelMessage) && (
          <div className="model-progress">
            <div className="progress-bar compact" aria-label={t("Progression téléchargement modèle")}>
              <span style={{ width: `${modelProgress}%` }} />
            </div>
            <p>{message(modelMessage)}</p>
          </div>
        )}
      </div>
      </fieldset>
    </section>
  );
}
