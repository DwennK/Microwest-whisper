import { message, t } from "../lib/i18n";
import appIcon from "../../assets/app-icon-small.png";
import { Cpu, FolderOpen, HardDrive, Info } from "lucide-react";
import { SectionTitle } from "../components/ui";
import { parakeetLabel } from "../lib/preferences";
import { formatBytes } from "../lib/format";
import type { AppDiagnostics, EngineStatus, ModelInfo, ModelInventory, LicenseSnapshot } from "../types";

interface AboutScreenProps {
  appInfo: AppDiagnostics | null;
  engine: EngineStatus | null;
  modelInventory: ModelInventory | null;
  selectedModel: ModelInfo | undefined;
  license: LicenseSnapshot | null;
  licenseOk: boolean;
  outputDir: string;
  workDir: string;
  onOpenPath: (path: string) => void;
}

export function AboutScreen({
  appInfo,
  engine,
  modelInventory,
  selectedModel,
  license,
  licenseOk,
  outputDir,
  workDir,
  onOpenPath,
}: AboutScreenProps) {
  return (
    <section className="screen about-screen">
      <header className="about-brand"><img src={appIcon} alt="" width={80} height={80} /><div><h2>Microwest Whisper</h2><p>{t("Votre audio devient du texte, sur votre ordinateur.")}</p><span>{t("Version")} {appInfo?.version ?? t("détection…")}</span></div></header>
      <div className="two-column">
      <div className="primary-panel">
        <SectionTitle icon={<Info size={20} />} title={t("Application")} />
        <dl className="details">
          <div>
            <dt>{t("Application")}</dt>
            <dd>{appInfo ? `${appInfo.name} ${appInfo.version}` : "Microwest Whisper"}</dd>
          </div>
          <div>
            <dt>{t("Moteur de transcription")}</dt>
            <dd>{selectedModel ? "sherpa-onnx" : appInfo?.backend ?? engine?.backend ?? t("détection…")}</dd>
          </div>
          <div>
            <dt>{t("Modèle actif")}</dt>
            <dd>
              {selectedModel
                ? `${parakeetLabel} · ${selectedModel.installed ? t("installé") : t("non installé")}`
                : engine?.default_model ?? t("non détecté")}
            </dd>
          </div>
          <div>
            <dt>{t("Plateforme")}</dt>
            <dd>{appInfo ? `${appInfo.platform} · ${appInfo.architecture}` : t("détection...")}</dd>
          </div>
          <div>
            <dt>{t("Licence")}</dt>
            <dd>{license?.state.development_mode === true ? t("Mode développement") : licenseOk ? t("active") : message(license?.status_text) || t("à vérifier")}</dd>
          </div>
          <div>
            <dt>{t("Mises à jour")}</dt>
            <dd>{appInfo?.update_endpoint ?? "GitHub Releases"}</dd>
          </div>
          <div>
            <dt>{t("Vérification des versions")}</dt>
            <dd>{t("Signatures Tauri + SHA256SUMS.txt sur GitHub Releases")}</dd>
          </div>
        </dl>
      </div>
      <div className="secondary-panel">
        <SectionTitle icon={<HardDrive size={20} />} title={t("Chemins locaux")} />
        <dl className="details engine-details">
          <div>
            <dt>{t("Ressources moteur")}</dt>
            <dd>{appInfo?.engine_root ?? engine?.engine_root ?? t("non détecté")}</dd>
          </div>
          <div>
            <dt>{t("Modèles")}</dt>
            <dd>{appInfo?.model_dir ?? modelInventory?.models_dir ?? t("non détecté")}</dd>
          </div>
          <div>
            <dt>{t("Espace modèles")}</dt>
            <dd>{formatBytes(modelInventory?.total_downloaded_bytes ?? 0)}</dd>
          </div>
          <div>
            <dt>{t("Sorties")}</dt>
            <dd>{outputDir || appInfo?.default_output_dir || t("non détecté")}</dd>
          </div>
          <div>
            <dt>{t("Travail temporaire")}</dt>
            <dd>{workDir || appInfo?.default_work_dir || t("non détecté")}</dd>
          </div>
          <div>
            <dt>{t("Licence locale")}</dt>
            <dd>{appInfo?.license_state_path ?? t("non détecté")}</dd>
          </div>
        </dl>
        <div className="model-actions">
          <button type="button" disabled={!modelInventory?.models_dir} onClick={() => modelInventory?.models_dir && onOpenPath(modelInventory.models_dir)}>
            <HardDrive size={17} />
            {t("Modèles")}
          </button>
          <button type="button" disabled={!outputDir} onClick={() => outputDir && onOpenPath(outputDir)}>
            <FolderOpen size={17} />
            {t("Sorties")}
          </button>
          <button type="button" disabled={!engine?.engine_root} onClick={() => engine?.engine_root && onOpenPath(engine.engine_root)}>
            <Cpu size={17} />
            {t("Moteur")}
          </button>
        </div>
      </div>
      </div>
    </section>
  );
}
