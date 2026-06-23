import { FileAudio, FolderOpen } from "lucide-react";
import { SectionTitle } from "../components/ui";
import { fileName } from "../lib/format";
import type { EngineStatus } from "../types";

interface AudioScreenProps {
  audioPath: string;
  outputDir: string;
  engine: EngineStatus | null;
  onChooseAudio: () => void;
  onChooseOutputDir: () => void;
  onRevealAudio: (path: string) => void;
}

export function AudioScreen({ audioPath, outputDir, engine, onChooseAudio, onChooseOutputDir, onRevealAudio }: AudioScreenProps) {
  return (
    <section className="screen two-column">
      <div className="primary-panel">
        <SectionTitle icon={<FileAudio size={20} />} title="Fichier audio" />
        <div className="file-target">
          <strong>{audioPath ? fileName(audioPath) : "Aucun fichier sélectionné"}</strong>
          <span>{audioPath || "Formats: m4a, mp3, mp4, wav, webm, flac, ogg"}</span>
        </div>
        <div className="action-row">
          <button className="primary" type="button" onClick={onChooseAudio}>
            <FileAudio size={17} />
            Choisir audio
          </button>
          {audioPath && (
            <button type="button" onClick={() => onRevealAudio(audioPath)}>
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
        <button type="button" onClick={onChooseOutputDir}>
          <FolderOpen size={17} />
          Changer le dossier
        </button>
      </div>
    </section>
  );
}
