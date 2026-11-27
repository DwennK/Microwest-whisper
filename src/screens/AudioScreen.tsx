import { message, t } from "../lib/i18n";
import { ArrowUp, AudioLines, Download, FileAudio, FolderOpen, Loader2, Minus, Play, Plus, Settings2 } from "lucide-react";
import type { QueueItem } from "../hooks/useAudioQueue";
import { SectionTitle } from "../components/ui";
import { fileName } from "../lib/format";
import { parakeetLabel } from "../lib/preferences";
import type { EngineStatus, ModelInfo } from "../types";

interface AudioScreenProps {
  audioPath: string;
  outputDir: string;
  engine: EngineStatus | null;
  selectedModel: ModelInfo | undefined;
  modelReady: boolean;
  modelBusy: boolean;
  modelProgress: number;
  modelMessage: string;
  locked: boolean;
  canStart: boolean;
  disabledReason: string;
  onChooseAudio: () => void;
  queue: QueueItem[];
  onAddAudio: () => void;
  onMoveUp: (index: number) => void;
  onRemove: (index: number) => void;
  onReview: (path: string) => void;
  onChooseOutputDir: () => void;
  onRevealAudio: (path: string) => void;
  onSettings: () => void;
  onDownload: () => void;
  onStart: () => void;
}

export function AudioScreen(props: AudioScreenProps) {
  const queued = props.queue.length > 0;
  const finished = queued && props.queue.every(item => item.status === "completed");
  const labels = { pending: "En attente", running: "En cours", completed: "Terminé", failed: "Échec", cancelled: "Annulé" };
  return (
    <section className="screen audio-screen">
      <p className="screen-intro">{t("Déposez vos enregistrements ici ou choisissez-les sur votre ordinateur.")}</p>
      <div className="two-column audio-picker-grid">
        <div className="primary-panel">
          <SectionTitle icon={<FileAudio size={20} />} title={queued ? t("File d’attente") : t("Fichier audio")} />
          {queued ? <ol className="audio-queue">
            {props.queue.map((item, index) => <li key={item.path}>
              <div><strong title={item.path}>{fileName(item.path)}</strong><small>{item.path}</small>
                <span>{t(labels[item.status])}{item.error && " · " + message(item.error)}</span></div>
              {item.status === "completed" && <button type="button" disabled={props.locked} onClick={() => props.onReview(item.path)}>{t("Lire")}</button>}
              <button type="button" className="icon-button" disabled={props.locked || index === 0} aria-label={t("Monter {0}", fileName(item.path))} onClick={() => props.onMoveUp(index)}><ArrowUp size={15} /></button>
              <button type="button" className="icon-button" disabled={props.locked} aria-label={t("Retirer {0}", fileName(item.path))} onClick={() => props.onRemove(index)}><Minus size={15} /></button>
            </li>)}
          </ol> : <div className={props.audioPath ? "file-target has-file" : "file-target"}>
            <div className="audio-file-symbol"><AudioLines size={36} strokeWidth={1.5} /></div>
            <strong>{props.audioPath ? fileName(props.audioPath) : t("Quel fichier souhaitez-vous transcrire ?")}</strong>
            <span title={props.audioPath}>{props.audioPath || "MP3, M4A, WAV, MP4, WebM, FLAC, OGG…"}</span>
          </div>}
          <div className="action-row">
            <button className={props.audioPath ? "" : "primary"} type="button" disabled={props.locked} onClick={props.onChooseAudio}>
              <FileAudio size={17} />{queued ? t("Remplacer la liste") : props.audioPath ? t("Changer de fichier") : t("Choisir des fichiers")}
            </button>
            {props.audioPath && <button type="button" disabled={props.locked} onClick={props.onAddAudio}><Plus size={17} />{t("Ajouter des fichiers")}</button>}
            {props.audioPath && !queued && <button type="button" onClick={() => props.onRevealAudio(props.audioPath)}><FolderOpen size={17} />{t("Afficher")}</button>}
          </div>
        </div>
        <div className="secondary-panel">
          <SectionTitle icon={<FolderOpen size={20} />} title={t("Dossier de sortie")} />
          <div className="file-target compact">
            <strong>{props.outputDir ? fileName(props.outputDir) : t("Transcriptions")}</strong>
            <span title={props.outputDir || props.engine?.default_output_dir}>{props.outputDir || props.engine?.default_output_dir}</span>
          </div>
          <button type="button" disabled={props.locked} onClick={props.onChooseOutputDir}><FolderOpen size={17} />{t("Changer le dossier")}</button>
          <p className="field-help">{t("Vos fichiers texte, Word et sous-titres seront enregistrés ici.")}</p>
        </div>
      </div>
      <div className="audio-settings-summary">
        <div><span>{t("Langue")}</span><strong>{t("Détection automatique")}</strong></div>
        <div><span>{t("Modèle")}</span><strong>{parakeetLabel}</strong></div>
        <button type="button" onClick={props.onSettings}><Settings2 size={17} />{t("Réglages")}</button>
      </div>
      {!props.modelReady && props.selectedModel && (
        <section className="model-onboarding" aria-label={t("Installation du modèle")}>
          <div><strong>{props.modelBusy ? t("Téléchargement du modèle…") : t("Un modèle à télécharger pour commencer")}</strong>
            <p>{props.selectedModel.size_label} {t("· Après installation, la transcription fonctionne localement.")}</p>
          </div>
          <button type="button" disabled={props.modelBusy || props.locked} onClick={props.onDownload}>
            {props.modelBusy ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
            {props.modelBusy ? `${props.modelProgress} %` : t("Télécharger · {0}", props.selectedModel.size_label)}
          </button>
          {(props.modelBusy || props.modelMessage) && <div className="model-progress" role="status">
            <progress max={100} value={props.modelProgress} aria-label={t("Téléchargement du modèle")} />
            <p>{message(props.modelMessage)}</p>
          </div>}
        </section>
      )}
      <footer className="screen-actions">
        <div><strong>{finished ? t("Transcription terminée") : props.canStart ? t("Prêt à transcrire") : t("Avant de commencer")}</strong>
          {!finished && <span>{props.canStart ? t("Vous pourrez écouter, corriger et exporter le résultat.") : message(props.disabledReason)}</span>}
        </div>
        <button className="primary continue-button" type="button" disabled={!props.canStart} onClick={props.onStart}><Play size={18} />{t("Transcrire")}</button>
      </footer>
    </section>
  );
}
