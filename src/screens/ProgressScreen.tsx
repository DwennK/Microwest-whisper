import { message, t } from "../lib/i18n";
import { AudioLines, Check, CircleStop, CircleX, Info, Loader2, Play } from "lucide-react";
import { SectionTitle } from "../components/ui";
import { fileName, formatSegmentTimestamp } from "../lib/format";
import type { TranscriptionPhase } from "../hooks/useTranscription";
interface StageStep { stage: string; min: number; }
interface ProgressScreenProps {
  audioPath: string;
  position?: string;
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
  const title = { idle: t("Prêt à commencer"), starting: t("Préparation du traitement"), running: message(props.stage), cancelling: t("Annulation en cours…"), completed: t("Transcription terminée"), failed: t("La transcription a échoué"), cancelled: t("Transcription annulée") }[phase];
  return (
    <section className="screen progress-screen">
      <div className="primary-panel">
        <div className={`progress-hero phase-${phase}`}>
        <div className={`progress-symbol${running ? " is-processing" : ""}`} aria-hidden="true">{phase === "completed" ? <Check size={32} /> : phase === "failed" ? <CircleX size={32} /> : <AudioLines size={32} />}</div>
        <SectionTitle icon={<Play size={20} />} title={props.audioPath ? [props.position, fileName(props.audioPath)].filter(Boolean).join(" · ") : t("Votre transcription")} />
        <div className="progress-head">
          <div role="status"><strong>{title}</strong>
            <span>{running ? [t("Temps écoulé : {0}", formatSegmentTimestamp(props.elapsedSeconds)), props.estimatedRemaining === null ? "" : t("Temps restant estimé : {0}", formatSegmentTimestamp(props.estimatedRemaining))].filter(Boolean).join(" · ") : phase === "completed" ? t("Le texte et les fichiers sont prêts à être ouverts.") : phase === "cancelled" ? t("Vous pouvez relancer ou choisir un autre fichier.") : phase === "failed" ? t("Consultez le message d’erreur avant de réessayer.") : t("Choisissez un fichier, puis lancez la transcription.")}</span>
          </div>
          <div className="progress-percentage" aria-hidden="true">{Math.round(progress)}<small>%</small></div>
        </div>
        <div className={`progress-bar phase-${phase}`} role="progressbar" aria-label={t("Progression transcription")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={title}><span style={{ width: `${progress}%` }} /></div>
        </div>
        <div className="progress-command-row">
          <p>{running ? t("Vous pouvez laisser cette fenêtre ouverte pendant le traitement.") : phase === "completed" ? t("Votre transcription est prête.") : t("Le traitement reste sur votre ordinateur.")}</p>
          <div className="action-row compact-actions">
            {running ? <button type="button" disabled={phase === "starting" || phase === "cancelling"} onClick={props.onCancel}>
              {phase === "cancelling" ? <Loader2 className="spin" size={17} /> : <CircleStop size={17} />}{props.position ? t("Arrêter la file") : t("Annuler")}
            </button> : phase === "completed" ? <button className="primary" type="button" onClick={props.onResults}>{t("Voir les résultats")}</button> : <button className="primary" type="button" disabled={!props.canStart} onClick={props.onStart}><Play size={17} />{phase === "idle" ? t("Transcrire") : t("Relancer")}</button>}
          </div>
        </div>

        {!props.canStart && !running && phase !== "completed" && <p className="inline-status">{message(props.disabledReason)}</p>}
        <div className="stage-grid">{props.stageSteps.map((item, index) => <div key={item.stage} className={running && item.stage === props.stage ? "stage-card is-current" : progress >= item.min ? "stage-card is-done" : "stage-card"}><span>{progress >= item.min && item.stage !== props.stage ? <Check size={12} /> : index + 1}</span><strong>{message(item.stage)}</strong></div>)}</div>
        <div className="progress-footer">
          <button className="log-toggle" type="button" onClick={props.onToggleLogs} aria-expanded={props.showLogs}><Info size={16} />{props.showLogs ? t("Masquer les détails") : t("Détails techniques")}</button>
          {!running && <button type="button" onClick={props.onAudio}>{t("Retour au fichier")}</button>}
        </div>
        {props.showLogs && <pre className="log-view">{props.logLines.length ? props.logLines.map(line => line.startsWith("[system] ") ? message(line.slice(9)) : message(line)).join("\n") : t("Le journal apparaîtra ici.")}</pre>}
      </div>
    </section>
  );
}
