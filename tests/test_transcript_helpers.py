from __future__ import annotations

import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from transcript_paths import expected_output_paths, source_id, transcript_stem, work_wav_path
from transcribe import (
    apply_speaker_map,
    build_audio_filter,
    checkpoint_signature,
    extract_meeting_notes,
    format_ts,
    is_repetitive_hallucination,
    load_checkpoint,
    merge_turns,
    normalize_segments,
    parse_speaker_map,
    Paths,
    sanitize_segments_for_alignment,
    save_checkpoint,
    validate_args,
)


class TranscriptPathTests(unittest.TestCase):
    def test_transcript_stem_adds_stable_source_id(self) -> None:
        audio = Path("/tmp/Reunion client.m4a")

        self.assertEqual(transcript_stem(audio), f"Reunion_client-{source_id(audio)}")

    def test_expected_output_paths_match_export_contract(self) -> None:
        audio = Path("/tmp/reunion.m4a")
        output_dir = Path("/tmp/output")

        names = [path.name for path in expected_output_paths(audio, output_dir)]

        self.assertIn(f"{transcript_stem(audio)}.speaker-turns.txt", names)
        self.assertIn(f"{transcript_stem(audio)}.clean.txt", names)
        self.assertIn(f"{transcript_stem(audio)}.notes.md", names)
        self.assertIn(f"{transcript_stem(audio)}.transcript.docx", names)

    def test_work_wav_uses_same_stem(self) -> None:
        audio = Path("/tmp/reunion.m4a")

        self.assertEqual(work_wav_path(audio, Path("/tmp/work")).name, f"{transcript_stem(audio)}.16k-mono.wav")


class TranscriptFormattingTests(unittest.TestCase):
    def test_format_ts_rounds_to_milliseconds(self) -> None:
        self.assertEqual(format_ts(3723.4567), "01:02:03,457")
        self.assertEqual(format_ts(None, sep="."), "00:00:00.000")

    def test_normalize_segments_removes_empty_text(self) -> None:
        result = {
            "segments": [
                {"start": 1, "end": 2, "speaker": "SPEAKER_01", "text": "  bonjour   tout le monde  "},
                {"start": 3, "end": 4, "text": "   "},
            ]
        }

        self.assertEqual(
            normalize_segments(result),
            [
                {
                    "start": 1.0,
                    "end": 2.0,
                    "speaker": "SPEAKER_01",
                    "text": "bonjour tout le monde",
                    "words": [],
                }
            ],
        )

    def test_repetitive_hallucination_detects_long_repeated_text(self) -> None:
        self.assertTrue(is_repetitive_hallucination("inform inform inform inform inform inform inform inform"))
        self.assertTrue(is_repetitive_hallucination("Quelle" + "issez" * 80))
        self.assertFalse(is_repetitive_hallucination("oui oui, on valide ce point et on continue"))

    def test_sanitize_segments_removes_only_repetitive_hallucinations(self) -> None:
        result = {
            "segments": [
                {"start": 0, "end": 1, "text": "Bonjour tout le monde"},
                {"start": 1, "end": 2, "text": "inform inform inform inform inform inform inform inform"},
            ]
        }

        with redirect_stdout(StringIO()):
            cleaned = sanitize_segments_for_alignment(result, "test")

        self.assertEqual(len(cleaned["segments"]), 1)
        self.assertEqual(cleaned["segments"][0]["text"], "Bonjour tout le monde")
        self.assertIn("dropped_repetitive_segments", cleaned)

    def test_merge_turns_groups_same_speaker_with_short_gap(self) -> None:
        turns = merge_turns(
            [
                {"start": 0.0, "end": 1.0, "speaker": "A", "text": "Bonjour"},
                {"start": 1.5, "end": 2.0, "speaker": "A", "text": "suite"},
                {"start": 2.1, "end": 3.0, "speaker": "B", "text": "Reponse"},
            ],
            max_gap=0.6,
        )

        self.assertEqual(len(turns), 2)
        self.assertEqual(turns[0]["text"], "Bonjour suite")
        self.assertEqual(turns[0]["end"], 2.0)

    def test_extract_meeting_notes_detects_basic_items(self) -> None:
        notes = extract_meeting_notes(
            [
                {"start": 0.0, "end": 1.0, "speaker": "A", "text": "Je vais envoyer le devis."},
                {"start": 2.0, "end": 3.0, "speaker": "B", "text": "Decision validee pour lundi."},
                {"start": 4.0, "end": 5.0, "speaker": "A", "text": "Quel budget reste disponible ?"},
            ]
        )

        self.assertEqual(len(notes["actions"]), 1)
        self.assertEqual(len(notes["decisions"]), 1)
        self.assertEqual(len(notes["questions"]), 1)

    def test_parse_and_apply_speaker_map(self) -> None:
        mapping = parse_speaker_map("SPEAKER_00=Alice,SPEAKER_01=Bruno")
        result = {
            "segments": [
                {
                    "speaker": "SPEAKER_00",
                    "text": "Bonjour",
                    "words": [{"speaker": "SPEAKER_01", "word": "Bonjour"}],
                }
            ]
        }

        updated = apply_speaker_map(result, mapping)

        self.assertEqual(updated["segments"][0]["speaker"], "Alice")
        self.assertEqual(updated["segments"][0]["words"][0]["speaker"], "Bruno")
        self.assertEqual(result["segments"][0]["speaker"], "SPEAKER_00")

    def test_build_audio_filter_variants(self) -> None:
        self.assertEqual(build_audio_filter(SimpleNamespace(audio_filter="none", trim_silence=False)), None)
        self.assertIn(
            "silenceremove",
            build_audio_filter(SimpleNamespace(audio_filter="voice-clean", trim_silence=True)),
        )

    def test_checkpoint_is_ignored_when_settings_change(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audio = root / "audio.m4a"
            audio.write_bytes(b"audio")
            paths = Paths(audio=audio, output_dir=root, work_dir=root, wav=root / "audio.wav")
            args = SimpleNamespace(
                audio_filter="loudnorm",
                trim_silence=False,
                profile="manual",
                model="large-v3-turbo",
                language="fr",
                asr_backend="mlx",
                mlx_model="auto",
                batch_size=8,
                threads=0,
                device="auto",
                compute_type="auto",
                no_diarization=True,
                speakers=None,
                min_speakers=None,
                max_speakers=None,
            )
            signature = checkpoint_signature(args, "asr", "mlx")

            with redirect_stdout(StringIO()):
                save_checkpoint(paths, "asr", {"segments": []}, signature)
                self.assertIsNotNone(load_checkpoint(paths, "asr", signature=signature))
                args.model = "large-v3"
                changed_signature = checkpoint_signature(args, "asr", "mlx")
                self.assertIsNone(load_checkpoint(paths, "asr", signature=changed_signature))

    def test_validate_args_rejects_mixed_speaker_modes(self) -> None:
        args = SimpleNamespace(
            doctor=False,
            check_token=False,
            audio="audio.m4a",
            speakers=2,
            min_speakers=1,
            max_speakers=None,
            rename_only=False,
            speaker_map="",
            speaker_map_file="",
        )

        with redirect_stderr(StringIO()):
            with self.assertRaises(SystemExit):
                validate_args(args)


if __name__ == "__main__":
    unittest.main()
