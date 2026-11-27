import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ResultsScreen } from "./ResultsScreen";
import type { HistoryRecord, OutputFile, TranscriptSegment } from "../types";

const segments: TranscriptSegment[] = [
  { start: 0, end: 1.25, text: "Bonjour" },
  { start: 61.5, end: 62.345, text: "Suite de la transcription" },
];

const outputs: OutputFile[] = [
  { label: "Sous-titres SRT", path: "/out/meeting.segments.srt", exists: true },
  { label: "Texte propre", path: "/out/meeting.clean.txt", exists: true },
  { label: "Document Word", path: "/out/meeting.transcript.docx", exists: true },
];

const history: HistoryRecord[] = [
  {
    created_at: "2026-01-01T10:00:00Z",
    status: "success",
    source_audio: "/audio/meeting.wav",
    stem: "meeting",
    duration_seconds: 62.345,
    language: "fr",
    model: "large-v3-turbo-q8_0",
    diarization: false,
    outputs: ["/out/meeting.clean.txt"],
  },
];

function renderResults(overrides: Partial<ComponentProps<typeof ResultsScreen>> = {}) {
  const props: ComponentProps<typeof ResultsScreen> = {
    audioPath: "/audio/meeting.wav",
    audioSource: "asset://localhost/audio/meeting.wav",
    audioPlaybackMessage: "",
    outputs,
    selectionOutputs: [],
    preview: "Aperçu complet",
    segments,
    selectedSegments: [0, 1],
    selectedEditableSegments: segments,
    selectedText: "Bonjour\n\nSuite de la transcription",
    hasSegmentEdits: false,
    history,
    resultMessage: "",
    outputDir: "/out",
    onAudio: vi.fn(),
    onOpenPath: vi.fn(),
    onRevealPath: vi.fn(),
    onCopyText: vi.fn(),
    onExportSelection: vi.fn(),
    onSaveFullTranscript: vi.fn(),
    onToggleSegment: vi.fn(),
    onSetVisibleSegments: vi.fn(),
    onUpdateSegment: vi.fn(),
    onLoadHistoryRecord: vi.fn(),
    ...overrides,
  };

  return {
    props,
    ...render(<ResultsScreen {...props} />),
  };
}

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
});

describe("ResultsScreen", () => {
  it("starts with a readable document and reveals editing and selection tools on demand", () => {
    const { props } = renderResults();
    expect(screen.getByText("Bonjour")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Texte du segment 1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enregistrer les corrections" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Corriger" }));
    fireEvent.change(screen.getByLabelText("Texte du segment 1"), { target: { value: "Bonjour corrigé" } });
    expect(props.onUpdateSegment).toHaveBeenCalledWith(0, "Bonjour corrigé");
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner" }));
    fireEvent.click(screen.getByLabelText("Sélectionner le segment 2"));
    expect(props.onToggleSegment).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Exporter la sélection" }));
    expect(props.onExportSelection).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Exporter la sélection" })).toBeInTheDocument();
  });

  it("requires saving corrections before opening complete files", () => {
    const { props } = renderResults({ hasSegmentEdits: true });
    fireEvent.click(screen.getByRole("button", { name: "Exporter" }));
    expect(screen.getByRole("button", { name: "Ouvrir Texte propre" })).toBeDisabled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Enregistrer les corrections" }));
    expect(props.onSaveFullTranscript).toHaveBeenCalledOnce();
  });

  it("shows save failures inside the export dialog and keeps stale files disabled", () => {
    renderResults({ hasSegmentEdits: true, resultError: "Disque plein" });
    fireEvent.click(screen.getByRole("button", { name: "Exporter" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("alert")).toHaveTextContent("Disque plein");
    expect(dialog.getByRole("button", { name: "Ouvrir Texte propre" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Enregistrer les corrections" })).toBeEnabled();
  });

  it("opens complete files and reveals their exact location in the export window", () => {
    const { props } = renderResults();
    fireEvent.click(screen.getByRole("button", { name: "Exporter" }));
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir Sous-titres SRT" }));
    expect(props.onOpenPath).toHaveBeenCalledWith("/out/meeting.segments.srt");
    fireEvent.click(screen.getByRole("button", { name: "Afficher Texte propre dans le dossier" }));
    expect(props.onRevealPath).toHaveBeenCalledWith("/out/meeting.clean.txt");
  });

  it("copies the full text independently of the selection and provides a scoped SRT preview", () => {
    const { props } = renderResults({ selectedSegments: [1], selectedEditableSegments: [segments[1]], selectedText: segments[1].text });
    fireEvent.click(screen.getByRole("button", { name: "Copier le texte" }));
    expect(props.onCopyText).toHaveBeenLastCalledWith("Bonjour\n\nSuite de la transcription");
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner" }));
    fireEvent.click(screen.getByRole("button", { name: "Copier la sélection" }));
    expect(props.onCopyText).toHaveBeenLastCalledWith("Suite de la transcription");
    fireEvent.click(screen.getByRole("button", { name: "Exporter la sélection" }));
    fireEvent.click(screen.getByText("Aperçu des sous-titres SRT"));
    fireEvent.click(screen.getByRole("button", { name: "Copier le SRT" }));
    expect(props.onCopyText).toHaveBeenLastCalledWith("1\n00:01:01,500 --> 00:01:02,345\nSuite de la transcription");
  });

  it("seeks and starts playback when a segment timestamp is selected", async () => {
    renderResults();
    const audio = screen.getByLabelText("Lecteur audio meeting.wav") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 120 });
    const play = vi.spyOn(audio, "play").mockResolvedValue();
    fireEvent.click(screen.getByRole("button", { name: "00:01:01" }));
    expect(audio.currentTime).toBe(61.5);
    expect(play).toHaveBeenCalledOnce();
  });

  it("follows the audio clock across speech, silence, paused seeks and the end of playback", () => {
    renderResults();
    const audio = screen.getByLabelText("Lecteur audio meeting.wav") as HTMLAudioElement;
    const [first, second] = screen.getAllByRole("article");
    fireEvent.play(audio);
    expect(first).toHaveAttribute("aria-current", "time");
    audio.currentTime = segments[0].end;
    fireEvent.timeUpdate(audio);
    expect(screen.queryByRole("article", { current: "time" })).toBeNull();
    audio.currentTime = segments[1].start;
    fireEvent.timeUpdate(audio);
    fireEvent.pause(audio);
    expect(second).toHaveAttribute("aria-current", "time");
    audio.currentTime = 0.5;
    fireEvent.seeked(audio);
    expect(first).toHaveAttribute("aria-current", "time");
    expect(second).not.toHaveAttribute("aria-current");
    fireEvent.ended(audio);
    expect(screen.queryByRole("article", { current: "time" })).toBeNull();
  });

  it("scrolls only the transcript when a new passage is out of view in reading mode", () => {
    renderResults();
    const audio = screen.getByLabelText("Lecteur audio meeting.wav") as HTMLAudioElement;
    const list = screen.getByLabelText("Texte de la transcription");
    const [first, second] = screen.getAllByRole("article");
    Object.defineProperty(list, "clientHeight", { value: 200 });
    list.scrollTo = vi.fn();
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 500, 200));
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 110, 500, 40));
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 460, 500, 40));
    fireEvent.play(audio);
    expect(list.scrollTo).not.toHaveBeenCalled();
    audio.currentTime = segments[1].start;
    fireEvent.timeUpdate(audio);
    expect(list.scrollTo).toHaveBeenCalledWith({ top: 280 });
    audio.currentTime += 0.1;
    fireEvent.timeUpdate(audio);
    for (const mode of ["Corriger", "Sélectionner"]) {
      fireEvent.click(screen.getByRole("button", { name: mode }));
      audio.currentTime = 0;
      fireEvent.seeked(audio);
      audio.currentTime = segments[1].start;
      fireEvent.timeUpdate(audio);
    }
    expect(list.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard seeking without intercepting editing, controls or dialogs", () => {
    renderResults();
    const audio = screen.getByLabelText("Lecteur audio meeting.wav") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 120 });
    const play = vi.spyOn(audio, "play").mockResolvedValue();
    audio.currentTime = 10;
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(audio.currentTime).toBe(15);
    fireEvent.click(screen.getByRole("button", { name: "Corriger" }));
    fireEvent.keyDown(screen.getByLabelText("Texte du segment 1"), { key: "ArrowRight" });
    expect(audio.currentTime).toBe(15);
    fireEvent.keyDown(screen.getByRole("button", { name: "Avancer de 5 secondes" }), { key: " " });
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Historique" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(audio.currentTime).toBe(15);
  });

  it("selects only search results and can clear the entire selection", async () => {
    const { props } = renderResults();
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner" }));
    fireEvent.change(screen.getByLabelText("Rechercher dans la transcription"), { target: { value: "suite" } });
    await waitFor(() => expect(screen.queryByText("Bonjour")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner les résultats" }));
    expect(props.onSetVisibleSegments).toHaveBeenCalledWith([1], true);
    fireEvent.click(screen.getByRole("button", { name: "Effacer la sélection" }));
    expect(props.onSetVisibleSegments).toHaveBeenLastCalledWith([0, 1], false);
  });

  it("shows only a starting action and recent documents when no transcription is open", () => {
    const { props } = renderResults({ outputs: [], segments: [], selectedSegments: [], selectedEditableSegments: [], selectedText: "", preview: "", audioPath: "", audioSource: "" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exporter" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choisir un fichier audio" }));
    expect(props.onAudio).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /meeting.wav/ }));
    expect(props.onLoadHistoryRecord).toHaveBeenCalledWith("/audio/meeting.wav", "/out");
  });
});
