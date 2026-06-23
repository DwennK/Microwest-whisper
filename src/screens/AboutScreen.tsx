import { Cpu, FolderOpen, HardDrive, Info } from "lucide-react";
import { SectionTitle } from "../components/ui";
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
          <button type="button" disabled={!modelInventory?.models_dir} onClick={() => modelInventory?.models_dir && onOpenPath(modelInventory.models_dir)}>
            <HardDrive size={17} />
            Modèles
          </button>
          <button type="button" disabled={!outputDir} onClick={() => outputDir && onOpenPath(outputDir)}>
            <FolderOpen size={17} />
            Sorties
          </button>
          <button type="button" disabled={!engine?.engine_root} onClick={() => engine?.engine_root && onOpenPath(engine.engine_root)}>
            <Cpu size={17} />
            Moteur
          </button>
        </div>
      </div>
    </section>
  );
}
