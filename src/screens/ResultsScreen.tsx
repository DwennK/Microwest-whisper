import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Clipboard, Download, ExternalLink, FileText, FolderOpen, FolderSearch, History, ListChecks, PencilLine, Rewind, FastForward, Save, Search, X } from "lucide-react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { buildSrt, fileName, formatDuration, formatSegmentTimestamp } from "../lib/format";
import type { HistoryRecord, OutputFile, TranscriptSegment } from "../types";

interface ResultsScreenProps {
  busy?: boolean;
  resultError?: string;
  audioPath: string;
  audioSource: string;
  audioPlaybackMessage: string;
  outputs: OutputFile[];
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
  onAudio: () => void;
  onOpenPath: (path: string) => void;
  onRevealPath: (path: string) => void;
  onCopyText: (text: string) => void;
  onExportSelection: () => void;
  onSaveFullTranscript: () => void;
  onToggleSegment: (index: number) => void;
  onSetVisibleSegments: (indexes: number[], selected: boolean) => void;
  onUpdateSegment: (index: number, text: string) => void;
  onLoadHistoryRecord: (audioPath: string, outputDir: string) => void;
}

function ResultsDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [previousFocus] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => { previousFocus?.focus(); };
  }, [previousFocus]);
  return <dialog ref={dialog} className="document-dialog" aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><button type="button" className="icon-button" aria-label="Fermer" autoFocus onClick={onClose}><X size={20} /></button></header>
    {children}
  </dialog>;
}

export function ResultsScreen({
  busy = false, resultError = "", audioPath, audioSource, audioPlaybackMessage, outputs, selectionOutputs,
  preview, segments, selectedSegments, selectedEditableSegments, selectedText,
  hasSegmentEdits, history, resultMessage, outputDir, onAudio, onOpenPath, onRevealPath,
  onCopyText, onExportSelection, onSaveFullTranscript, onToggleSegment,
  onSetVisibleSegments, onUpdateSegment, onLoadHistoryRecord,
}: ResultsScreenProps) {
  const [mode, setMode] = useState<"read" | "edit" | "select">(hasSegmentEdits ? "edit" : "read");
  const [panel, setPanel] = useState<"files" | "selection" | "history" | null>(null);
  const [segmentSearch, setSegmentSearch] = useState("");
  const [focusedSegment, setFocusedSegment] = useState<number | null>(null);
  const [audioError, setAudioError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const debouncedSearch = useDebouncedValue(segmentSearch, 160);
  const filteredSegments = useMemo(() => segments.map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.text.toLocaleLowerCase().includes(debouncedSearch.trim().toLocaleLowerCase())), [debouncedSearch, segments]);
  const visibleIndexes = useMemo(() => filteredSegments.map(({ index }) => index), [filteredSegments]);
  const fullText = useMemo(() => segments.map((segment) => segment.text.trim()).filter(Boolean).join("\n\n"), [segments]);
  const isSelection = panel === "selection";
  const panelText = isSelection ? selectedText : fullText || preview;
  const panelSrt = useMemo(() => buildSrt(isSelection ? selectedEditableSegments : segments), [isSelection, selectedEditableSegments, segments]);
  const selectedCount = selectedEditableSegments.length;
  const hiddenSelectedCount = selectedSegments.filter((index) => !visibleIndexes.includes(index)).length;
  const duration = segments[segments.length - 1]?.end ?? 0;

  async function playFrom(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number.POSITIVE_INFINITY;
    audio.currentTime = Math.max(0, Math.min(seconds, duration));
    setAudioError("");
    try { await audio.play(); } catch (error) { setAudioError(`Lecture impossible : ${String(error)}`); }
  }
  function seekRelative(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + delta, Number.isFinite(audio.duration) ? audio.duration : Number.POSITIVE_INFINITY));
  }
  useEffect(() => { setAudioError(""); }, [audioSource]);
  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      const target = event.target;
      if (panel || (target instanceof HTMLElement && (target.closest("input, textarea, select, button, a, audio") || target.isContentEditable))) return;
      const audio = audioRef.current;
      if (!audio) return;
      if (event.key === " ") {
        event.preventDefault();
        if (audio.paused) void audio.play().catch((error) => setAudioError(`Lecture impossible : ${String(error)}`));
        else audio.pause();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); seekRelative(event.key === "ArrowLeft" ? -5 : 5);
      }
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [panel]);
  useEffect(() => { listRef.current?.scrollTo?.({ top: 0 }); }, [debouncedSearch]);

  function renderHistory() {
    return <div className="document-history">
      {history.length === 0 && <p className="muted">Les transcriptions terminées apparaîtront ici.</p>}
      {history.slice(0, 6).map((record) => <button key={`${record.created_at}-${record.stem}`} type="button" disabled={busy}
        onClick={() => { setPanel(null); onLoadHistoryRecord(record.source_audio, outputDir); }}>
        <FileText size={20} /><span><strong>{fileName(record.source_audio)}</strong><small>{formatDuration(record.duration_seconds)} · {new Date(record.created_at).toLocaleDateString("fr-CH")}</small></span><ArrowRight size={17} />
      </button>)}
    </div>;
  }

  function renderFiles(files: OutputFile[], disabled: boolean) {
    return <div className="document-files">{files.map((item) => <div key={item.path}>
      <FileText size={20} /><span><strong>{item.label}</strong><small title={item.path}>{fileName(item.path)}</small></span>
      <button type="button" disabled={disabled || !item.exists} aria-label={`Ouvrir ${item.label}`} onClick={() => onOpenPath(item.path)}><ExternalLink size={16} />Ouvrir</button>
      <button className="icon-button" type="button" disabled={disabled || !item.exists} aria-label={`Afficher ${item.label} dans le dossier`} title="Afficher dans le dossier" onClick={() => onRevealPath(item.path)}><FolderSearch size={17} /></button>
    </div>)}</div>;
  }

  if (segments.length === 0) return <section className="screen results-home">
    <div className="results-welcome">
      <div className="results-welcome-icon"><FileText size={30} /></div>
      <h2>{audioPath ? "Ce fichier n’a pas encore de transcription" : history.length ? "Ouvrez une transcription" : "Transcrivez votre premier fichier"}</h2>
      <p>{audioPath ? fileName(audioPath) : "Choisissez un fichier audio, puis retrouvez ici son texte et ses exports."}</p>
      <button type="button" className="primary" disabled={busy} onClick={onAudio}>{audioPath ? "Revenir au fichier audio" : "Choisir un fichier audio"}<ArrowRight size={17} /></button>
    </div>
    {history.length > 0 && <section className="results-recent"><h3>Reprendre une transcription</h3>{renderHistory()}</section>}
  </section>;

  return <section className="screen document-workspace">
    <header className="document-header">
      <div className="document-identity"><h2 title={audioPath}>{fileName(audioPath)}</h2><span>{formatDuration(duration)} · {segments.length} passage{segments.length > 1 ? "s" : ""}{hasSegmentEdits && <b> · Corrections non enregistrées</b>}</span></div>
      <div className="document-actions">
        <button type="button" disabled={busy} onClick={() => setPanel("history")}><History size={17} />Historique</button>
        <button type="button" className="primary" disabled={busy} onClick={() => setPanel("files")}><Download size={17} />Exporter</button>
      </div>
    </header>
    <fieldset className="plain-fieldset document-surface" disabled={busy}>
      <div className="document-listen">
        {audioSource ? <>
          <button className="icon-button" type="button" aria-label="Reculer de 5 secondes" title="Reculer de 5 secondes" onClick={() => seekRelative(-5)}><Rewind size={17} /></button>
          <audio ref={audioRef} aria-label={`Lecteur audio ${fileName(audioPath)}`} controls preload="metadata" src={audioSource}
            onError={() => setAudioError("Ce format audio ne peut pas être lu directement. La transcription reste disponible.")} />
          <button className="icon-button" type="button" aria-label="Avancer de 5 secondes" title="Avancer de 5 secondes" onClick={() => seekRelative(5)}><FastForward size={17} /></button>
          <span className="listen-hint">Cliquez sur un horaire<br />pour écouter le passage</span>
        </> : <p className="muted">{audioPlaybackMessage || "Lecture audio indisponible pour ce fichier."}</p>}
      </div>
      {audioError && <p className="document-notice" role="alert">{audioError}</p>}
      <div className="document-toolbar">
        <div className="document-modes" role="group" aria-label="Mode de transcription">
          <button type="button" aria-pressed={mode === "read"} onClick={() => setMode("read")}><FileText size={16} />Lire</button>
          <button type="button" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}><PencilLine size={16} />Corriger</button>
          <button type="button" aria-pressed={mode === "select"} onClick={() => setMode("select")}><ListChecks size={16} />Sélectionner</button>
        </div>
        <label className="search-field document-search"><Search size={16} /><input aria-label="Rechercher dans la transcription" placeholder="Rechercher un passage…" value={segmentSearch} onChange={(event) => setSegmentSearch(event.target.value)} /></label>
      </div>
      {mode === "edit" && <div className="document-context"><span>{hasSegmentEdits ? "Vos corrections sont prêtes à enregistrer." : "Cliquez dans le texte pour le corriger."}</span><button type="button" className={hasSegmentEdits ? "primary" : ""} disabled={!hasSegmentEdits} onClick={onSaveFullTranscript}><Save size={16} />Enregistrer les corrections</button></div>}
      {mode === "select" && <div className="document-context"><span><strong>{selectedCount}</strong> passage{selectedCount > 1 ? "s" : ""} sélectionné{selectedCount > 1 ? "s" : ""}{hiddenSelectedCount > 0 && ` · ${hiddenSelectedCount} hors recherche`}</span>
        <button type="button" className="text-button" disabled={!filteredSegments.length} onClick={() => onSetVisibleSegments(visibleIndexes, true)}>{segmentSearch ? "Sélectionner les résultats" : "Tout sélectionner"}</button>
        <button type="button" className="text-button" disabled={!selectedCount} onClick={() => onSetVisibleSegments(segments.map((_, index) => index), false)}>Effacer la sélection</button>
      </div>}
      {segmentSearch && <div className="document-search-status" role="status">{filteredSegments.length} passage{filteredSegments.length > 1 ? "s" : ""} trouvé{filteredSegments.length > 1 ? "s" : ""}<button type="button" className="text-button" onClick={() => setSegmentSearch("")}>Effacer la recherche</button></div>}
      <div className={`document-body mode-${mode}`} ref={listRef} tabIndex={0} aria-label="Texte de la transcription">
        {!filteredSegments.length && <p className="muted">Aucun passage ne correspond à cette recherche.</p>}
        {filteredSegments.map(({ segment, index }) => <article key={`${index}-${segment.start}`} className={`document-passage${focusedSegment === index ? " is-focused" : ""}${mode === "select" && selectedSegments.includes(index) ? " is-selected" : ""}`}>
          {mode === "select" && <label className="segment-check" aria-label={`Sélectionner le segment ${index + 1}`}><input type="checkbox" checked={selectedSegments.includes(index)} onChange={() => onToggleSegment(index)} /><span /></label>}
          <button type="button" className="timestamp-button" disabled={!audioSource} title="Écouter ce passage" onClick={() => { setFocusedSegment(index); void playFrom(segment.start); }}>{formatSegmentTimestamp(segment.start)}</button>
          {mode === "edit" ? <textarea aria-label={`Texte du segment ${index + 1}`} rows={Math.max(3, Math.ceil(segment.text.length / 85))} value={segment.text} onChange={(event) => onUpdateSegment(index, event.target.value)} /> : <p>{segment.text}</p>}
        </article>)}
      </div>
      <footer className="document-footer">
        <span role="status">{busy ? "Enregistrement…" : resultMessage || (mode === "select" ? "Cochez les passages à conserver dans votre extrait." : "Espace : lecture / pause · ← → : reculer / avancer")}</span>
        {mode === "select" ? <><button type="button" disabled={!selectedCount} onClick={() => onCopyText(selectedText)}><Clipboard size={16} />Copier la sélection</button><button type="button" className="primary" disabled={!selectedCount} onClick={() => { setPanel("selection"); onExportSelection(); }}><Download size={16} />Exporter la sélection</button></>
          : <button type="button" onClick={() => onCopyText(fullText)}><Clipboard size={16} />Copier le texte</button>}
      </footer>
    </fieldset>
    {panel && <ResultsDialog title={panel === "history" ? "Historique récent" : isSelection ? "Exporter la sélection" : "Exporter la transcription"} onClose={() => setPanel(null)}>
      {resultError && <p className="notice error" role="alert">{resultError}</p>}
      {panel === "history" ? renderHistory() : <>
        <p className="document-dialog-description">{isSelection ? `${selectedCount} passage${selectedCount > 1 ? "s" : ""} · TXT, Word et sous-titres SRT` : "Votre transcription complète, prête à utiliser."}</p>
        {!isSelection && hasSegmentEdits && <div className="document-save-notice"><p>Enregistrez vos corrections pour mettre les fichiers à jour.</p><button type="button" className="primary" disabled={busy} onClick={onSaveFullTranscript}><Save size={16} />Enregistrer les corrections</button></div>}
        <div role="status" className="document-export-status">{busy ? "Enregistrement des fichiers…" : resultMessage}</div>
        {renderFiles(isSelection ? selectionOutputs : outputs, busy || (!isSelection && hasSegmentEdits))}
        {!busy && (isSelection ? selectionOutputs : outputs).filter((item) => item.exists).length === 0 && <p>Aucun fichier disponible.{isSelection && " Fermez cette fenêtre pour réessayer l’export."}</p>}
        <details className="document-srt"><summary>Aperçu des sous-titres SRT</summary><pre>{panelSrt}</pre><button type="button" disabled={busy || !panelSrt} onClick={() => onCopyText(panelSrt)}><Clipboard size={16} />Copier le SRT</button></details>
        <footer><button type="button" disabled={busy || !outputDir} onClick={() => onOpenPath(outputDir)}><FolderOpen size={17} />Ouvrir le dossier</button><button type="button" disabled={busy || !panelText} onClick={() => onCopyText(panelText)}><Clipboard size={16} />{isSelection ? "Copier la sélection" : "Copier le texte"}</button></footer>
      </>}
    </ResultsDialog>}
  </section>;
}
