import { AudioLines, Check, CircleStop, CircleX, Info, Loader2, Play } from "lucide-react";
import { SectionTitle } from "../components/ui";
import { fileName, formatSegmentTimestamp } from "../lib/format";
import type { TranscriptionPhase } from "../hooks/useTranscription";
interface StageStep { stage: string; min: number; }
interface ProgressScreenProps {
  audioPath: string;
  phase: TranscriptionPhase;
  running: boolean;
  canStart: boolean;
  disabledReason: string;
  stage: string;
  progress: number;
  elapsedSeconds: number;
  estimatedRemaining: number | null;
  showLogs: boolean;
  logLines: string[];
  stageSteps: StageStep[];
  onStart: () => void;
  onCancel: () => void;
  onToggleLogs: () => void;
  onAudio: () => void;
  onResults: () => void;
}
export function ProgressScreen(props: ProgressScreenProps) {
  const { phase, running, progress } = props;
  const title = { idle: "Prêt à commencer", starting: "Préparation du traitement", running: props.stage, cancelling: "Annulation en cours…", completed: "Transcription terminée", failed: "La transcription a échoué", cancelled: "Transcription annulée" }[phase];
  return (
    <section className="screen progress-screen">
      <div className="primary-panel">
        <div className={`progress-hero phase-${phase}`}>
        <div className={`progress-symbol${running ? " is-processing" : ""}`} aria-hidden="true">{phase === "completed" ? <Check size={32} /> : phase === "failed" ? <CircleX size={32} /> : <AudioLines size={32} />}</div>
        <SectionTitle icon={<Play size={20} />} title={props.audioPath ? fileName(props.audioPath) : "Votre transcription"} />
        <div className="progress-head">
          <div role="status"><strong>{title}</strong>
            <span>{running ? `${formatSegmentTimestamp(props.elapsedSeconds)} écoulé${props.estimatedRemaining !== null ? ` · Environ ${formatSegmentTimestamp(props.estimatedRemaining)} restantes` : ""}` : phase === "completed" ? "Le texte et les fichiers sont prêts à être ouverts." : phase === "cancelled" ? "Vous pouvez relancer ou choisir un autre fichier." : phase === "failed" ? "Consultez le message d’erreur avant de réessayer." : "Choisissez un fichier, puis lancez la transcription."}</span>
          </div>
          <div className="progress-percentage" aria-hidden="true">{Math.round(progress)}<small>%</small></div>
        </div>
        <div className={`progress-bar phase-${phase}`} role="progressbar" aria-label="Progression transcription" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={title}><span style={{ width: `${progress}%` }} /></div>
        </div>
        <div className="progress-command-row">
          <p>{running ? "Vous pouvez laisser cette fenêtre ouverte pendant le traitement." : phase === "completed" ? "Votre transcription est prête." : "Le traitement reste sur votre ordinateur."}</p>
          <div className="action-row compact-actions">
            {running ? <button type="button" disabled={phase === "starting" || phase === "cancelling"} onClick={props.onCancel}>
              {phase === "cancelling" ? <Loader2 className="spin" size={17} /> : <CircleStop size={17} />}Annuler
            </button> : phase === "completed" ? <button className="primary" type="button" onClick={props.onResults}>Voir les résultats</button> : <button className="primary" type="button" disabled={!props.canStart} onClick={props.onStart}><Play size={17} />{phase === "idle" ? "Transcrire" : "Relancer"}</button>}
          </div>
        </div>

        {!props.canStart && !running && phase !== "completed" && <p className="inline-status">{props.disabledReason}</p>}
        <div className="stage-grid">{props.stageSteps.map((item, index) => <div key={item.stage} className={running && item.stage === props.stage ? "stage-card is-current" : progress >= item.min ? "stage-card is-done" : "stage-card"}><span>{progress >= item.min && item.stage !== props.stage ? <Check size={12} /> : index + 1}</span><strong>{item.stage}</strong></div>)}</div>
        <div className="progress-footer">
          <button className="log-toggle" type="button" onClick={props.onToggleLogs} aria-expanded={props.showLogs}><Info size={16} />{props.showLogs ? "Masquer les détails" : "Détails techniques"}</button>
          {!running && <button type="button" onClick={props.onAudio}>Retour au fichier</button>}
        </div>
        {props.showLogs && <pre className="log-view">{props.logLines.length ? props.logLines.join("\n") : "Le journal apparaîtra ici."}</pre>}
      </div>
    </section>
  );
}
