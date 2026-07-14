import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ResultsScreen } from "./ResultsScreen";
import type { HistoryRecord, OutputFile, TranscriptSegment } from "../types";

const segments: TranscriptSegment[] = [
  { start: 0, end: 1.25, text: "Bonjour" },
  { start: 61.5, end: 62.345, text: "Suite de la transcription" },
];

const outputs: OutputFile[] = [
  { label: "Markdown", path: "/out/meeting.transcript.md", exists: true },
  { label: "SRT", path: "/out/meeting.segments.srt", exists: false },
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
    outputs: ["/out/meeting.transcript.md"],
  },
];

function renderResults(overrides: Partial<ComponentProps<typeof ResultsScreen>> = {}) {
  const props: ComponentProps<typeof ResultsScreen> = {
    audioPath: "/audio/meeting.wav",
    audioSource: "asset://localhost/audio/meeting.wav",
    audioPlaybackMessage: "",
    outputs,
    quickOutputs: outputs.filter((item) => item.exists),
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
    onOpenPath: vi.fn(),
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

describe("ResultsScreen", () => {
  it("surfaces local segment edits and exports the edited selection", () => {
    const onUpdateSegment = vi.fn();
    const onExportSelection = vi.fn();
    const onSaveFullTranscript = vi.fn();

    renderResults({
      hasSegmentEdits: true,
      onUpdateSegment,
      onExportSelection,
      onSaveFullTranscript,
    });

    expect(screen.getByText("Modifications locales prêtes pour l'export sélection.")).toBeInTheDocument();
    expect(screen.getByText("L'export sélection utilisera les textes modifiés ci-contre.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Texte du segment 1"), {
      target: { value: "Bonjour corrigé" },
    });
    expect(onUpdateSegment).toHaveBeenCalledWith(0, "Bonjour corrigé");

    fireEvent.click(screen.getByRole("button", { name: /Exporter sélection/i }));
    expect(onExportSelection).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Enregistrer exports complets/i }));
    expect(onSaveFullTranscript).toHaveBeenCalled();
  });

  it("copies text and SRT previews from the selected segments", () => {
    const onCopyText = vi.fn();
    renderResults({ onCopyText });

    fireEvent.click(screen.getByRole("button", { name: /Copier/i }));
    expect(onCopyText).toHaveBeenLastCalledWith("Bonjour\n\nSuite de la transcription");

    fireEvent.click(screen.getByRole("button", { name: "SRT" }));
    fireEvent.click(screen.getByRole("button", { name: /Copier/i }));
    expect(onCopyText).toHaveBeenLastCalledWith(
      "1\n00:00:00,000 --> 00:00:01,250\nBonjour\n\n2\n00:01:01,500 --> 00:01:02,345\nSuite de la transcription",
    );
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

  it("supports keyboard seeking outside editable and interactive fields", () => {
    renderResults();
    const audio = screen.getByLabelText("Lecteur audio meeting.wav") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { configurable: true, value: 120 });
    const play = vi.spyOn(audio, "play").mockResolvedValue();
    audio.currentTime = 10;

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(audio.currentTime).toBe(15);

    fireEvent.keyDown(screen.getByLabelText("Texte du segment 1"), { key: "ArrowRight" });
    expect(audio.currentTime).toBe(15);

    fireEvent.keyDown(screen.getByRole("button", { name: "Avancer de 5 secondes" }), { key: " " });
    expect(play).not.toHaveBeenCalled();
  });

  it("filters segments before selecting visible rows", async () => {
    const onSetVisibleSegments = vi.fn();
    renderResults({ onSetVisibleSegments });

    fireEvent.change(screen.getByPlaceholderText("Rechercher dans la transcription"), {
      target: { value: "suite" },
    });

    await waitFor(() => expect(screen.queryByLabelText("Texte du segment 1")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Tout sélectionner/i }));

    expect(onSetVisibleSegments).toHaveBeenCalledWith([1], true);
  });

  it("shows actionable empty states", () => {
    renderResults({
      outputs: [],
      quickOutputs: [],
      segments: [],
      selectedSegments: [],
      selectedEditableSegments: [],
      selectedText: "",
      history: [],
      preview: "",
      audioPath: "",
      audioSource: "",
    });

    expect(screen.getByText(/Aucun segment chargé pour ce fichier/i)).toBeInTheDocument();
    expect(screen.getByText(/Sélectionnez un fichier audio pour afficher les exports attendus/i)).toBeInTheDocument();
    expect(screen.getByText(/L'historique apparaîtra ici/i)).toBeInTheDocument();
  });
});
