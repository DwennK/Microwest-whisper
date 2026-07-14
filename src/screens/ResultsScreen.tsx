import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleStop, Clipboard, FastForward, FileText, PencilLine, Rewind, Save, Search, Subtitles, Volume2 } from "lucide-react";
import { SectionTitle } from "../components/ui";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { buildSrt, fileName, formatDuration, formatSegmentTimestamp } from "../lib/format";
import type { HistoryRecord, OutputFile, TranscriptSegment } from "../types";

const VIRTUAL_ROW_HEIGHT = 132;
const VIRTUAL_VIEWPORT_HEIGHT = 620;
const VIRTUAL_OVERSCAN = 6;

interface ResultsScreenProps {
  audioPath: string;
  audioSource: string;
  audioPlaybackMessage: string;
  outputs: OutputFile[];
  quickOutputs: OutputFile[];
  selectionOutputs: OutputFile[];
  preview: string;
  segments: TranscriptSegment[];
  selectedSegments: number[];
  selectedEditableSegments: TranscriptSegment[];
  selectedText: string;
  hasSegmentEdits: boolean;
  history: HistoryRecord[];
  resultMessage: string;
  outputDir: string;
  onOpenPath: (path: string) => void;
  onCopyText: (text: string) => void;
  onExportSelection: () => void;
  onSaveFullTranscript: () => void;
  onToggleSegment: (index: number) => void;
  onSetVisibleSegments: (indexes: number[], selected: boolean) => void;
  onUpdateSegment: (index: number, text: string) => void;
  onLoadHistoryRecord: (audioPath: string, outputDir: string) => void;
}

export function ResultsScreen({
  audioPath,
  audioSource,
  audioPlaybackMessage,
  outputs,
  quickOutputs,
  selectionOutputs,
  preview,
  segments,
  selectedSegments,
  selectedEditableSegments,
  selectedText,
  hasSegmentEdits,
  history,
  resultMessage,
  outputDir,
  onOpenPath,
  onCopyText,
  onExportSelection,
  onSaveFullTranscript,
  onToggleSegment,
  onSetVisibleSegments,
  onUpdateSegment,
  onLoadHistoryRecord,
}: ResultsScreenProps) {
  const [segmentSearch, setSegmentSearch] = useState("");
  const [focusedSegment, setFocusedSegment] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState<"text" | "srt">("text");
  const [scrollTop, setScrollTop] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioError, setAudioError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const debouncedSearch = useDebouncedValue(segmentSearch, 160);

  const filteredSegments = useMemo(() => {
    const query = debouncedSearch.trim().toLocaleLowerCase();
    if (!query) return segments.map((segment, index) => ({ segment, index }));
    return segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.text.toLocaleLowerCase().includes(query));
  }, [debouncedSearch, segments]);

  const srtPreview = useMemo(() => buildSrt(selectedEditableSegments), [selectedEditableSegments]);
  const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
  const visibleCount = Math.ceil(VIRTUAL_VIEWPORT_HEIGHT / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
  const visibleRows = filteredSegments.slice(startIndex, startIndex + visibleCount);
  const visibleIndexes = useMemo(() => filteredSegments.map(({ index }) => index), [filteredSegments]);
  const readyOutputs = useMemo(() => outputs.filter((item) => item.exists), [outputs]);

  async function playFrom(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : Number.POSITIVE_INFINITY;
    audio.currentTime = Math.max(0, Math.min(seconds, duration));
    setAudioCurrentTime(audio.currentTime);
    setAudioError("");
    try {
      await audio.play();
    } catch (error) {
      setAudioError(`Lecture impossible: ${String(error)}`);
    }
  }

  function seekRelative(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY;
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + delta, duration));
    setAudioCurrentTime(audio.currentTime);
  }

  function focusSegment(index: number) {
    setFocusedSegment(index);
    const filteredIndex = filteredSegments.findIndex((item) => item.index === index);
    if (filteredIndex >= 0) {
      listRef.current?.scrollTo?.({ top: filteredIndex * VIRTUAL_ROW_HEIGHT, behavior: "smooth" });
    }
    void playFrom(segments[index]?.start ?? 0);
  }

  useEffect(() => {
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setAudioError("");
  }, [audioSource]);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || target instanceof HTMLButtonElement
        || target instanceof HTMLAnchorElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      const audio = audioRef.current;
      if (!audio) return;

      if (event.key === " ") {
        event.preventDefault();
        if (audio.paused) {
          void audio.play().catch((error) => setAudioError(`Lecture impossible: ${String(error)}`));
        } else {
          audio.pause();
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekRelative(-5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekRelative(5);
      }
    }

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, []);

  const copyPayload = previewMode === "srt" ? srtPreview : selectedText || preview;
  const emptySegmentsMessage = segments.length === 0
    ? "Aucun segment chargé pour ce fichier. Lancez une transcription ou ouvrez un résultat existant depuis l'historique."
    : "Aucun segment ne correspond à cette recherche.";

  return (
    <section className="screen results-grid">
      <div className="primary-panel">
        <SectionTitle icon={<Search size={20} />} title="Segments" />
        {audioPath && (
          <div className="audio-player">
            <div className="audio-player-head">
              <div>
                <span className="audio-player-label"><Volume2 size={16} /> Écoute synchronisée</span>
                <strong>{fileName(audioPath)}</strong>
              </div>
              <span>{formatSegmentTimestamp(audioCurrentTime)} / {formatSegmentTimestamp(audioDuration)}</span>
            </div>
            {audioSource ? (
              <audio
                ref={audioRef}
                aria-label={`Lecteur audio ${fileName(audioPath)}`}
                controls
                preload="metadata"
                src={audioSource}
                onDurationChange={(event) => setAudioDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                onTimeUpdate={(event) => setAudioCurrentTime(event.currentTarget.currentTime)}
                onError={() => setAudioError("Ce format audio ne peut pas être lu directement. La transcription reste disponible.")}
              />
            ) : (
              <p className="inline-status">{audioPlaybackMessage || "Lecture audio indisponible pour ce fichier."}</p>
            )}
            <div className="audio-player-actions">
              <button type="button" aria-label="Reculer de 5 secondes" disabled={!audioSource} onClick={() => seekRelative(-5)}>
                <Rewind size={16} />
                5 s
              </button>
              <button type="button" aria-label="Avancer de 5 secondes" disabled={!audioSource} onClick={() => seekRelative(5)}>
                <FastForward size={16} />
                5 s
              </button>
              <small>Espace : lecture/pause · ←/→ : ±5 s · timestamp : lire le segment</small>
            </div>
            {audioError && <p className="inline-status audio-error">{audioError}</p>}
          </div>
        )}
        <div className="results-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input value={segmentSearch} placeholder="Rechercher dans la transcription" onChange={(event) => setSegmentSearch(event.target.value)} />
          </label>
          <button type="button" disabled={filteredSegments.length === 0} onClick={() => onSetVisibleSegments(visibleIndexes, true)}>
            <Check size={16} />
            Tout sélectionner
          </button>
          <button type="button" disabled={filteredSegments.length === 0} onClick={() => onSetVisibleSegments(visibleIndexes, false)}>
            <CircleStop size={16} />
            Désélectionner
          </button>
        </div>
        <div className="segment-summary">
          <strong>{selectedEditableSegments.length}</strong>
          <span>segment(s) sélectionné(s) sur {segments.length}</span>
        </div>
        <div className={hasSegmentEdits ? "edit-state is-dirty" : "edit-state"}>
          <PencilLine size={16} />
          <span>
            {hasSegmentEdits
              ? "Modifications locales prêtes pour l'export sélection."
              : "Les exports complets affichent la dernière transcription générée."}
          </span>
        </div>
        <div
          className="segment-list segment-virtual-list"
          ref={listRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {filteredSegments.length === 0 && <p className="muted empty-state">{emptySegmentsMessage}</p>}
          {filteredSegments.length > 0 && (
            <div className="segment-virtual-spacer" style={{ height: filteredSegments.length * VIRTUAL_ROW_HEIGHT }}>
              <div className="segment-virtual-stack" style={{ transform: `translateY(${startIndex * VIRTUAL_ROW_HEIGHT}px)` }}>
                {visibleRows.map(({ segment, index }) => (
                  <article id={`segment-${index}`} className={focusedSegment === index ? "segment-row is-focused" : "segment-row"} key={`${index}-${segment.start}`}>
                    <label className="segment-check" aria-label={`Sélectionner le segment ${index + 1}`}>
                      <input type="checkbox" checked={selectedSegments.includes(index)} onChange={() => onToggleSegment(index)} />
                      <span />
                    </label>
                    <button className="timestamp-button" type="button" onClick={() => focusSegment(index)}>
                      {formatSegmentTimestamp(segment.start)}
                    </button>
                    <textarea
                      aria-label={`Texte du segment ${index + 1}`}
                      value={segment.text}
                      onChange={(event) => onUpdateSegment(index, event.target.value)}
                    />
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="secondary-panel">
        <SectionTitle icon={<FileText size={20} />} title="Exports complets" />
        <div className="output-list">
          {outputs.length === 0 && <p className="muted empty-state">Sélectionnez un fichier audio pour afficher les exports attendus.</p>}
          {outputs.length > 0 && readyOutputs.length === 0 && (
            <p className="muted empty-state">Aucun export généré pour ce fichier dans le dossier de sortie actuel.</p>
          )}
          {outputs.map((item) => (
            <div className={item.exists ? "output-row is-ready" : "output-row"} key={item.path}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.path}</span>
              </div>
              <button type="button" disabled={!item.exists} onClick={() => onOpenPath(item.path)}>
                <FileText size={16} />
                Ouvrir
              </button>
            </div>
          ))}
        </div>
        <h2>Export sélection</h2>
        <p className="selection-note">
          {hasSegmentEdits
            ? "L'export sélection utilisera les textes modifiés ci-contre."
            : "Sélectionnez les segments à copier ou exporter."}
        </p>
        <div className="selection-actions">
          <button type="button" disabled={!hasSegmentEdits || segments.length === 0} onClick={onSaveFullTranscript}>
            <Save size={16} />
            Enregistrer exports complets
          </button>
          <button className="primary" type="button" disabled={selectedEditableSegments.length === 0} onClick={onExportSelection}>
            <Save size={16} />
            Exporter sélection
          </button>
          <button type="button" disabled={!copyPayload} onClick={() => onCopyText(copyPayload)}>
            <Clipboard size={16} />
            Copier
          </button>
        </div>
        {resultMessage && <p className="inline-status">{resultMessage}</p>}
        {selectionOutputs.length > 0 && (
          <div className="quick-list selection-output-list">
            {selectionOutputs.map((item) => (
              <button key={item.path} type="button" disabled={!item.exists} onClick={() => onOpenPath(item.path)}>
                <FileText size={16} />
                {item.label}
              </button>
            ))}
          </div>
        )}
        <h2>Accès rapide</h2>
        <div className="quick-list">
          {quickOutputs.length === 0 && <p className="muted empty-state">Aucun export prioritaire disponible pour ce fichier.</p>}
          {quickOutputs.map((item) => (
            <button key={item.path} type="button" disabled={!item.exists} onClick={() => onOpenPath(item.path)}>
              <FileText size={16} />
              {item.label}
            </button>
          ))}
        </div>
        <h2>Historique</h2>
        <div className="history-list">
          {history.length === 0 && <p className="muted empty-state">L'historique apparaîtra ici après une transcription réussie dans ce dossier.</p>}
          {history.slice(0, 6).map((record) => (
            <button key={`${record.created_at}-${record.stem}`} type="button" onClick={() => onLoadHistoryRecord(record.source_audio, outputDir)}>
              <span>{fileName(record.source_audio)}</span>
              <small>{record.model} · {formatDuration(record.duration_seconds)}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="preview-panel">
        <div className="preview-head">
          <SectionTitle icon={previewMode === "srt" ? <Subtitles size={20} /> : <FileText size={20} />} title={previewMode === "srt" ? "Aperçu SRT" : "Aperçu texte"} />
          <div className="segmented-control">
            <button className={previewMode === "text" ? "is-active" : ""} type="button" onClick={() => setPreviewMode("text")}>
              Texte
            </button>
            <button className={previewMode === "srt" ? "is-active" : ""} type="button" onClick={() => setPreviewMode("srt")}>
              SRT
            </button>
          </div>
        </div>
        <pre>{previewMode === "srt" ? srtPreview || "Sélectionnez au moins un segment pour générer l'aperçu SRT." : selectedText || preview || "Aucun aperçu Markdown ou texte disponible."}</pre>
      </div>
    </section>
  );
}
