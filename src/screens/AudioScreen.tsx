import { AudioLines, Download, FileAudio, FolderOpen, Loader2, Play, Settings2 } from "lucide-react";
import { SectionTitle } from "../components/ui";
import { fileName } from "../lib/format";
import { languageLabel, modelLabel } from "../lib/preferences";
import type { EngineStatus, ModelInfo } from "../types";

interface AudioScreenProps {
  audioPath: string;
  outputDir: string;
  engine: EngineStatus | null;
  language: string;
  model: string;
  selectedModel: ModelInfo | undefined;
  modelReady: boolean;
  modelBusy: boolean;
  modelProgress: number;
  modelMessage: string;
  locked: boolean;
  canStart: boolean;
  disabledReason: string;
  onChooseAudio: () => void;
  onChooseOutputDir: () => void;
  onRevealAudio: (path: string) => void;
  onSettings: () => void;
  onDownload: () => void;
  onStart: () => void;
}

export function AudioScreen(props: AudioScreenProps) {
  return (
    <section className="screen audio-screen">
      <p className="screen-intro">Choisissez votre fichier. Vos réglages sont déjà prêts.</p>
      <div className="two-column audio-picker-grid">
        <div className="primary-panel">
          <SectionTitle icon={<FileAudio size={20} />} title="Fichier audio" />
          <div className={props.audioPath ? "file-target has-file" : "file-target"}>
            <div className="audio-file-symbol"><AudioLines size={36} strokeWidth={1.5} /></div>
            <strong>{props.audioPath ? fileName(props.audioPath) : "Quel fichier souhaitez-vous transcrire ?"}</strong>
            <span title={props.audioPath}>{props.audioPath || "MP3, M4A, WAV, MP4, WebM, FLAC, OGG…"}</span>
          </div>
          <div className="action-row">
            <button className={props.audioPath ? "" : "primary"} type="button" disabled={props.locked} onClick={props.onChooseAudio}>
              <FileAudio size={17} />{props.audioPath ? "Changer de fichier" : "Choisir un fichier"}
            </button>
            {props.audioPath && <button type="button" onClick={() => props.onRevealAudio(props.audioPath)}><FolderOpen size={17} />Afficher</button>}
          </div>
        </div>
        <div className="secondary-panel">
          <SectionTitle icon={<FolderOpen size={20} />} title="Dossier de sortie" />
          <div className="file-target compact">
            <strong>{props.outputDir ? fileName(props.outputDir) : "Transcriptions"}</strong>
            <span title={props.outputDir || props.engine?.default_output_dir}>{props.outputDir || props.engine?.default_output_dir}</span>
          </div>
          <button type="button" disabled={props.locked} onClick={props.onChooseOutputDir}><FolderOpen size={17} />Changer le dossier</button>
          <p className="field-help">Vos fichiers texte, Word et sous-titres seront enregistrés ici.</p>
        </div>
      </div>
      <div className="audio-settings-summary">
        <div><span>Langue</span><strong>{languageLabel(props.language)}</strong></div>
        <div><span>Modèle</span><strong>{modelLabel(props.model)}</strong></div>
        <button type="button" onClick={props.onSettings}><Settings2 size={17} />Réglages</button>
      </div>
      {!props.modelReady && props.selectedModel && (
        <section className="model-onboarding" aria-label="Installation du modèle">
          <div><strong>{props.modelBusy ? "Téléchargement du modèle…" : "Un modèle à télécharger pour commencer"}</strong>
            <p>{props.selectedModel.size_label} · Après installation, la transcription fonctionne localement.</p>
          </div>
          <button type="button" disabled={props.modelBusy || props.locked} onClick={props.onDownload}>
            {props.modelBusy ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
            {props.modelBusy ? `${props.modelProgress} %` : `Télécharger · ${props.selectedModel.size_label}`}
          </button>
          {(props.modelBusy || props.modelMessage) && <div className="model-progress" role="status">
            <progress max={100} value={props.modelProgress} aria-label="Téléchargement du modèle" />
            <p>{props.modelMessage}</p>
          </div>}
        </section>
      )}
      <footer className="screen-actions">
        <div><strong>{props.canStart ? "Prêt à transcrire" : "Avant de commencer"}</strong>
          <span>{props.canStart ? "Vous pourrez écouter, corriger et exporter le résultat." : props.disabledReason}</span>
        </div>
        <button className="primary continue-button" type="button" disabled={!props.canStart} onClick={props.onStart}><Play size={18} />Transcrire</button>
      </footer>
    </section>
  );
}
