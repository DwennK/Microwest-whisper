import { CircleStop, Info, Loader2, Play } from "lucide-react";
import { SectionTitle } from "../components/ui";
import { formatDuration } from "../lib/format";

interface StageStep {
  stage: string;
  min: number;
}

interface ProgressScreenProps {
  running: boolean;
  canStart: boolean;
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
}

export function ProgressScreen({
  running,
  canStart,
  stage,
  progress,
  elapsedSeconds,
  estimatedRemaining,
  showLogs,
  logLines,
  stageSteps,
  onStart,
  onCancel,
  onToggleLogs,
}: ProgressScreenProps) {
  return (
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
            <button className="primary" type="button" disabled={!canStart} onClick={onStart}>
              {running ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
              Lancer
            </button>
            <button type="button" disabled={!running} onClick={onCancel}>
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
        <button className="log-toggle" type="button" onClick={onToggleLogs}>
          <Info size={16} />
          {showLogs ? "Masquer les détails" : "Détails techniques"}
        </button>
        {showLogs && <pre className="log-view">{logLines.length ? logLines.join("\n") : "Le journal apparaîtra ici."}</pre>}
      </div>
    </section>
  );
}
