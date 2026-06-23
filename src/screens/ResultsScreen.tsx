import { useMemo, useRef, useState } from "react";
import { Check, CircleStop, Clipboard, FileText, Save, Search, Subtitles } from "lucide-react";
import { SectionTitle } from "../components/ui";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { buildSrt, fileName, formatDuration, formatSegmentTimestamp } from "../lib/format";
import type { HistoryRecord, OutputFile, TranscriptSegment } from "../types";

const VIRTUAL_ROW_HEIGHT = 106;
const VIRTUAL_VIEWPORT_HEIGHT = 620;
const VIRTUAL_OVERSCAN = 6;

interface ResultsScreenProps {
  outputs: OutputFile[];
  quickOutputs: OutputFile[];
  selectionOutputs: OutputFile[];
  preview: string;
  segments: TranscriptSegment[];
  selectedSegments: number[];
  selectedEditableSegments: TranscriptSegment[];
  selectedText: string;
  history: HistoryRecord[];
  resultMessage: string;
  outputDir: string;
  onOpenPath: (path: string) => void;
  onCopyText: (text: string) => void;
  onExportSelection: () => void;
  onToggleSegment: (index: number) => void;
  onSetVisibleSegments: (indexes: number[], selected: boolean) => void;
  onUpdateSegment: (index: number, text: string) => void;
  onLoadHistoryRecord: (audioPath: string, outputDir: string) => void;
}

export function ResultsScreen({
  outputs,
  quickOutputs,
  selectionOutputs,
  preview,
  segments,
  selectedSegments,
  selectedEditableSegments,
  selectedText,
  history,
  resultMessage,
  outputDir,
  onOpenPath,
  onCopyText,
  onExportSelection,
  onToggleSegment,
  onSetVisibleSegments,
  onUpdateSegment,
  onLoadHistoryRecord,
}: ResultsScreenProps) {
  const [segmentSearch, setSegmentSearch] = useState("");
  const [focusedSegment, setFocusedSegment] = useState<number | null>(null);
  const [previewMode, setPreviewMode] = useState<"text" | "srt">("text");
  const [scrollTop, setScrollTop] = useState(0);
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

  function focusSegment(index: number) {
    setFocusedSegment(index);
    const filteredIndex = filteredSegments.findIndex((item) => item.index === index);
    if (filteredIndex >= 0) {
      listRef.current?.scrollTo({ top: filteredIndex * VIRTUAL_ROW_HEIGHT, behavior: "smooth" });
    }
  }

  const copyPayload = previewMode === "srt" ? srtPreview : selectedText || preview;

  return (
    <section className="screen results-grid">
      <div className="primary-panel">
        <SectionTitle icon={<Search size={20} />} title="Segments" />
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
        <div
          className="segment-list segment-virtual-list"
          ref={listRef}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {filteredSegments.length === 0 && <p className="muted">Aucun segment disponible pour ce fichier.</p>}
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
                    <textarea value={segment.text} onChange={(event) => onUpdateSegment(index, event.target.value)} />
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
        <div className="selection-actions">
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
          {quickOutputs.length === 0 && <p className="muted">Aucun export prioritaire disponible.</p>}
          {quickOutputs.map((item) => (
            <button key={item.path} type="button" disabled={!item.exists} onClick={() => onOpenPath(item.path)}>
              <FileText size={16} />
              {item.label}
            </button>
          ))}
        </div>
        <h2>Historique</h2>
        <div className="history-list">
          {history.length === 0 && <p className="muted">Aucun historique dans ce dossier.</p>}
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
