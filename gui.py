from __future__ import annotations

import json
import os
import platform
import shutil
import sys
from pathlib import Path

from dotenv import dotenv_values, set_key
from PySide6.QtCore import Qt, QProcess, QProcessEnvironment, QSettings, QTimer
from PySide6.QtGui import QDesktopServices, QFont, QIcon, QTextCursor
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
    QHeaderView,
    QAbstractItemView,
    QFileDialog,
    QFormLayout,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QSpinBox,
    QStatusBar,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from transcript_paths import SUPPORTED_AUDIO_EXTENSIONS, expected_output_paths


ROOT = Path(__file__).resolve().parent
INPUT_DIR = ROOT / "input"
OUTPUT_DIR = ROOT / "output"
WORK_DIR = ROOT / "work"
ENV_PATH = ROOT / ".env"
TRANSCRIBE = ROOT / "transcribe.py"
AUDIO_PATTERNS = " ".join(f"*{suffix}" for suffix in sorted(SUPPORTED_AUDIO_EXTENSIONS))
AUDIO_FILTER = f"Audio ({AUDIO_PATTERNS});;Tous les fichiers (*.*)"
PRESET_QUALITY = "Qualité max (large-v3)"
PRESET_AUTO = "Auto machine"
PRESET_FAST = "Rapide (large-v3-turbo)"
PRESET_CPU = "CPU léger (medium + int8)"
PRESET_NO_SPEAKERS = "Sans locuteurs (large-v3, no diarization)"
PRESET_LABELS = [PRESET_QUALITY, PRESET_AUTO, PRESET_FAST, PRESET_CPU, PRESET_NO_SPEAKERS]
PRESET_DESCRIPTIONS = {
    PRESET_QUALITY: "Le meilleur choix par défaut: précision prioritaire, plus lent sur CPU.",
    PRESET_AUTO: "Détecte la machine et choisit un profil prudent automatiquement.",
    PRESET_FAST: "Plus rapide, avec une petite concession possible sur la qualité.",
    PRESET_CPU: "Profil prudent pour une machine sans GPU ou avec peu de mémoire.",
    PRESET_NO_SPEAKERS: "Transcrit seulement le texte: pas de token HF, pas de séparation par personne.",
}

LANGUAGES = {
    "Français": "fr",
    "Anglais": "en",
    "Auto": "auto",
}
OLD_PRESET_NAMES = {
    "Meilleure qualite": PRESET_QUALITY,
    "Meilleure qualité": PRESET_QUALITY,
    "Qualite max (large-v3)": PRESET_QUALITY,
    "Rapide": PRESET_FAST,
    "CPU prudent": PRESET_CPU,
    "CPU leger (medium + int8)": PRESET_CPU,
    "Sans separation": PRESET_NO_SPEAKERS,
    "Sans séparation": PRESET_NO_SPEAKERS,
}


def venv_python() -> Path:
    if sys.platform == "win32":
        return ROOT / ".venv" / "Scripts" / "python.exe"
    return ROOT / ".venv" / "bin" / "python"


def setup_command() -> str:
    return ".\\setup.ps1" if sys.platform == "win32" else "./setup-mac.sh"


def recommended_preset() -> str:
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return PRESET_QUALITY
    if (os.cpu_count() or 4) <= 8:
        return PRESET_CPU
    return PRESET_FAST


class TranscriptionWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.process: QProcess | None = None
        self.token_process: QProcess | None = None
        self.preflight_process: QProcess | None = None
        self.regenerate_process: QProcess | None = None
        self.history_records: list[dict] = []
        self.speaker_inputs: dict[str, QLineEdit] = {}
        self.elapsed_seconds = 0
        self.settings = QSettings("Codex", "WhisperLocalTranscriber")
        INPUT_DIR.mkdir(exist_ok=True)
        OUTPUT_DIR.mkdir(exist_ok=True)
        WORK_DIR.mkdir(exist_ok=True)

        self.setWindowTitle("Microwest Whisper")
        self.setMinimumSize(1080, 760)
        self.setAcceptDrops(True)
        self.elapsed_timer = QTimer(self)
        self.elapsed_timer.timeout.connect(self._tick_elapsed)
        self._build_ui()
        self._load_settings()
        self._refresh_state()
        self.refresh_history()

    def _build_ui(self) -> None:
        central = QWidget()
        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        app_bar = QFrame()
        app_bar.setObjectName("AppBar")
        header = QHBoxLayout(app_bar)
        header.setContentsMargins(22, 16, 22, 16)
        header.setSpacing(14)

        brand_mark = QLabel("MW")
        brand_mark.setObjectName("BrandMark")
        brand_mark.setAlignment(Qt.AlignCenter)
        header.addWidget(brand_mark)

        title_wrap = QVBoxLayout()
        title_wrap.setSpacing(2)
        title = QLabel("Microwest Whisper")
        title.setObjectName("AppTitle")
        subtitle = QLabel("Transcription locale, diarisation et exports prêts à livrer.")
        subtitle.setObjectName("AppSubtitle")
        title_wrap.addWidget(title)
        title_wrap.addWidget(subtitle)
        header.addLayout(title_wrap)
        header.addStretch(1)

        self.open_input_btn = QPushButton("Input")
        self.open_input_btn.setObjectName("CommandButton")
        self.open_input_btn.clicked.connect(lambda: self.open_folder(INPUT_DIR))
        header.addWidget(self.open_input_btn)
        self.open_output_btn = QPushButton("Output")
        self.open_output_btn.setObjectName("CommandButton")
        self.open_output_btn.clicked.connect(self.open_output)
        header.addWidget(self.open_output_btn)
        root.addWidget(app_bar)

        self.tabs = QTabWidget()
        self.tabs.setTabPosition(QTabWidget.North)
        root.addWidget(self.tabs, 1)

        audio_screen = QWidget()
        audio_layout = QVBoxLayout(audio_screen)
        audio_layout.setContentsMargins(18, 18, 18, 18)
        audio_layout.setSpacing(16)

        self._add_page_header(
            audio_layout,
            "Étape 1",
            "Choisir l'audio",
            "Sélectionne un fichier source ou prends automatiquement le plus récent dans input.",
        )

        file_group = QGroupBox("Source audio")
        file_layout = QGridLayout(file_group)
        file_layout.setHorizontalSpacing(12)
        file_layout.setVerticalSpacing(10)
        file_layout.setColumnStretch(1, 1)

        self.audio_path = QLineEdit()
        self.audio_path.setPlaceholderText(r"C:\...\enregistrement.m4a")
        self.audio_path.textChanged.connect(self._refresh_state)

        browse_btn = QPushButton("Parcourir")
        browse_btn.clicked.connect(self.choose_file)
        latest_btn = QPushButton("Dernier dans input")
        latest_btn.clicked.connect(self.use_latest_input)

        file_layout.addWidget(QLabel("Audio"), 0, 0)
        file_layout.addWidget(self.audio_path, 0, 1)
        file_layout.addWidget(browse_btn, 0, 2)
        file_layout.addWidget(latest_btn, 0, 3)
        file_hint = QLabel("Astuce: tu peux aussi glisser-déposer un fichier audio dans la fenêtre.")
        file_hint.setObjectName("Muted")
        file_layout.addWidget(file_hint, 1, 1, 1, 3)
        audio_layout.addWidget(file_group)
        audio_layout.addStretch(1)

        audio_actions = QHBoxLayout()
        audio_actions.addStretch(1)
        self.next_audio_btn = QPushButton("Continuer vers les réglages")
        self.next_audio_btn.setObjectName("Primary")
        self.next_audio_btn.clicked.connect(lambda: self.tabs.setCurrentIndex(1))
        audio_actions.addWidget(self.next_audio_btn)
        audio_layout.addLayout(audio_actions)
        self._add_scroll_tab(audio_screen, "Audio")

        transcription_screen = QWidget()
        transcription_layout = QVBoxLayout(transcription_screen)
        transcription_layout.setContentsMargins(18, 18, 18, 18)
        transcription_layout.setSpacing(16)

        self._add_page_header(
            transcription_layout,
            "Étape 2",
            "Régler la transcription",
            "Choisis le profil, la diarisation et les contrôles utiles avant de lancer.",
        )

        self.settings_hint = QLabel("")
        self.settings_hint.setObjectName("Warning")
        self.settings_hint.setWordWrap(True)
        self.settings_hint.setVisible(False)
        transcription_layout.addWidget(self.settings_hint)

        transcription_group = QGroupBox("Options de transcription")
        transcription_group.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Maximum)
        transcription_form_layout = QVBoxLayout(transcription_group)
        transcription_form_layout.setSpacing(8)

        profile_label = QLabel("Profil")
        profile_label.setObjectName("FieldLabel")
        self.preset = QComboBox()
        self.preset.addItems(PRESET_LABELS)
        self.preset.setMinimumWidth(380)
        self.preset.currentIndexChanged.connect(self._apply_preset)
        transcription_form_layout.addWidget(profile_label)
        transcription_form_layout.addWidget(self.preset)
        transcription_form_layout.addSpacing(8)

        self.preset_description = QLabel("")
        self.preset_description.setObjectName("Muted")
        self.preset_description.setWordWrap(True)
        transcription_form_layout.addWidget(self.preset_description)
        transcription_form_layout.addSpacing(4)

        self.diarization = QCheckBox("Séparer les personnes")
        self.diarization.setChecked(True)
        self.diarization.stateChanged.connect(self._refresh_state)
        transcription_form_layout.addWidget(self.diarization)
        transcription_form_layout.addSpacing(6)

        self.speaker_mode = QComboBox()
        self.speaker_mode.addItems(["Auto", "Nombre exact", "Fourchette"])
        self.speaker_mode.setMinimumWidth(220)
        self.speaker_mode.currentIndexChanged.connect(self._refresh_state)
        self.speaker_mode_label = QLabel("Locuteurs")
        self.speaker_mode_label.setObjectName("FieldLabel")
        transcription_form_layout.addWidget(self.speaker_mode_label)
        transcription_form_layout.addWidget(self.speaker_mode)
        transcription_form_layout.addSpacing(8)

        self.speakers = QSpinBox()
        self.speakers.setRange(1, 20)
        self.speakers.setValue(3)
        self.speakers_label = QLabel("Exact")
        self.speakers_label.setObjectName("FieldLabel")
        transcription_form_layout.addWidget(self.speakers_label)
        transcription_form_layout.addWidget(self.speakers)

        self.min_speakers = QSpinBox()
        self.min_speakers.setRange(1, 20)
        self.min_speakers.setValue(2)
        self.min_speakers_label = QLabel("Minimum")
        self.min_speakers_label.setObjectName("FieldLabel")
        transcription_form_layout.addWidget(self.min_speakers_label)
        transcription_form_layout.addWidget(self.min_speakers)

        self.max_speakers = QSpinBox()
        self.max_speakers.setRange(1, 20)
        self.max_speakers.setValue(5)
        self.max_speakers_label = QLabel("Maximum")
        self.max_speakers_label.setObjectName("FieldLabel")
        transcription_form_layout.addWidget(self.max_speakers_label)
        transcription_form_layout.addWidget(self.max_speakers)

        self.speaker_names = QLineEdit()
        self.speaker_names.setPlaceholderText("SPEAKER_00=Alice,SPEAKER_01=Bruno")
        self.speaker_names.setMinimumWidth(420)
        self.speaker_names.textChanged.connect(self._refresh_state)
        speaker_names_label = QLabel("Noms locuteurs")
        speaker_names_label.setObjectName("FieldLabel")
        transcription_form_layout.addWidget(speaker_names_label)
        transcription_form_layout.addWidget(self.speaker_names)
        transcription_form_layout.addSpacing(8)
        for field in (
            self.preset,
            self.speaker_mode,
            self.speakers,
            self.min_speakers,
            self.max_speakers,
            self.speaker_names,
        ):
            field.setMinimumHeight(32)
        transcription_form_layout.addSpacing(8)

        self.advanced_toggle = QCheckBox("Afficher les réglages avancés")
        self.advanced_toggle.stateChanged.connect(self._toggle_advanced)
        transcription_form_layout.addWidget(self.advanced_toggle)

        self.advanced_group = QGroupBox("Réglages avancés")
        quality_form = QFormLayout(self.advanced_group)
        self.model = QComboBox()
        self.model.addItems(["large-v3", "medium", "small", "large-v3-turbo"])
        self.model.setCurrentText("large-v3")
        self.language = QComboBox()
        self.language.addItems(LANGUAGES.keys())
        self.asr_backend = QComboBox()
        self.asr_backend.addItems(["auto", "whisperx", "mlx"])
        self.audio_filter = QComboBox()
        self.audio_filter.addItems(["loudnorm", "voice-clean", "none"])
        self.trim_silence = QCheckBox("Rogner les silences au début et à la fin")
        self.force_recompute = QCheckBox("Recalculer sans réutiliser les checkpoints")
        self.batch_size = QSpinBox()
        self.batch_size.setRange(1, 32)
        self.batch_size.setValue(8)
        self.threads = QSpinBox()
        self.threads.setRange(0, 64)
        self.threads.setValue(0)
        self.threads.setSpecialValueText("auto")
        self.device = QComboBox()
        self.device.addItems(["auto", "cpu", "cuda"])
        self.compute_type = QComboBox()
        self.compute_type.addItems(["auto", "int8", "int8_float16", "float32", "float16"])
        for widget in (
            self.model,
            self.language,
            self.asr_backend,
            self.audio_filter,
            self.batch_size,
            self.threads,
            self.device,
            self.compute_type,
        ):
            if hasattr(widget, "currentIndexChanged"):
                widget.currentIndexChanged.connect(self._refresh_state)
            elif hasattr(widget, "valueChanged"):
                widget.valueChanged.connect(self._refresh_state)
        self.trim_silence.stateChanged.connect(self._refresh_state)
        self.force_recompute.stateChanged.connect(self._refresh_state)
        quality_form.addRow("Modèle", self.model)
        quality_form.addRow("Langue", self.language)
        quality_form.addRow("Backend", self.asr_backend)
        quality_form.addRow("Filtre audio", self.audio_filter)
        quality_form.addRow("", self.trim_silence)
        quality_form.addRow("", self.force_recompute)
        quality_form.addRow("Batch", self.batch_size)
        quality_form.addRow("Threads CPU", self.threads)
        quality_form.addRow("Device", self.device)
        quality_form.addRow("Calcul", self.compute_type)
        self.advanced_group.setVisible(False)

        preflight_group = QGroupBox("Contrôle avant lancement")
        preflight_group.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Maximum)
        preflight_layout = QVBoxLayout(preflight_group)
        self.preflight_summary = QLabel("Backend recommandé: " + self.recommended_backend_label())
        self.preflight_summary.setObjectName("Stage")
        preflight_layout.addWidget(self.preflight_summary)
        self.preflight_output = QTextEdit()
        self.preflight_output.setObjectName("Preflight")
        self.preflight_output.setReadOnly(True)
        self.preflight_output.setMaximumHeight(130)
        self.preflight_output.setPlainText("Lance une vérification pour contrôler .venv, FFmpeg, WhisperX et le token si nécessaire.")
        preflight_layout.addWidget(self.preflight_output)
        preflight_actions = QHBoxLayout()
        self.preflight_btn = QPushButton("Vérifier la configuration")
        self.preflight_btn.clicked.connect(self.run_preflight)
        preflight_actions.addWidget(self.preflight_btn)
        preflight_actions.addStretch(1)
        preflight_layout.addLayout(preflight_actions)

        transcription_workspace = QHBoxLayout()
        transcription_workspace.setSpacing(16)
        transcription_workspace.addWidget(transcription_group, 3, Qt.AlignTop)
        transcription_workspace.addWidget(preflight_group, 2, Qt.AlignTop)
        transcription_layout.addLayout(transcription_workspace)
        transcription_layout.addWidget(self.advanced_group)

        transcription_actions = QHBoxLayout()
        back_to_audio = QPushButton("Retour")
        back_to_audio.clicked.connect(lambda: self.tabs.setCurrentIndex(0))
        self.settings_shortcut_btn = QPushButton("Paramètres")
        self.settings_shortcut_btn.clicked.connect(lambda: self.tabs.setCurrentIndex(4))
        self.next_transcription_btn = QPushButton("Continuer vers l'exécution")
        self.next_transcription_btn.setObjectName("Primary")
        self.next_transcription_btn.clicked.connect(lambda: self.tabs.setCurrentIndex(2))
        transcription_actions.addWidget(back_to_audio)
        transcription_actions.addStretch(1)
        transcription_actions.addWidget(self.settings_shortcut_btn)
        transcription_actions.addWidget(self.next_transcription_btn)
        transcription_layout.addLayout(transcription_actions)
        self._add_scroll_tab(transcription_screen, "Réglages")

        execution_screen = QWidget()
        execution_layout = QVBoxLayout(execution_screen)
        execution_layout.setContentsMargins(18, 18, 18, 18)
        execution_layout.setSpacing(14)

        self._add_page_header(
            execution_layout,
            "Étape 3",
            "Lancer et suivre",
            "Démarre le traitement et garde les logs visibles pendant toute l'exécution.",
        )

        self.execution_hint = QLabel("")
        self.execution_hint.setObjectName("Warning")
        self.execution_hint.setWordWrap(True)
        self.execution_hint.setVisible(False)
        execution_layout.addWidget(self.execution_hint)

        actions = QHBoxLayout()
        self.start_btn = QPushButton("Lancer la transcription")
        self.start_btn.setObjectName("Primary")
        self.start_btn.clicked.connect(self.start_transcription)
        self.stop_btn = QPushButton("Arrêter")
        self.stop_btn.clicked.connect(self.stop_transcription)
        self.stop_btn.setEnabled(False)
        self.command_toggle = QPushButton("Afficher la commande")
        self.command_toggle.clicked.connect(self._toggle_command_preview)
        self.command_preview = QLineEdit()
        self.command_preview.setObjectName("CommandPreview")
        self.command_preview.setReadOnly(True)
        self.command_preview.setVisible(False)
        actions.addWidget(self.start_btn)
        actions.addWidget(self.stop_btn)
        actions.addWidget(self.command_toggle)
        actions.addStretch(1)
        execution_layout.addLayout(actions)
        execution_layout.addWidget(self.command_preview)

        progress_group = QGroupBox("État du traitement")
        progress_layout = QGridLayout(progress_group)
        progress_layout.setColumnStretch(1, 1)
        self.stage_label = QLabel("Prêt.")
        self.stage_label.setObjectName("Stage")
        self.elapsed_label = QLabel("00:00")
        self.elapsed_label.setObjectName("Muted")
        self.progress = QProgressBar()
        self.progress.setRange(0, 1)
        self.progress.setValue(0)
        progress_layout.addWidget(QLabel("État"), 0, 0)
        progress_layout.addWidget(self.stage_label, 0, 1)
        progress_layout.addWidget(self.elapsed_label, 0, 2)
        progress_layout.addWidget(self.progress, 1, 0, 1, 3)
        execution_layout.addWidget(progress_group)

        self.log = QTextEdit()
        self.log.setObjectName("Console")
        self.log.setReadOnly(True)
        self.log.setLineWrapMode(QTextEdit.NoWrap)
        font = QFont("Consolas")
        font.setStyleHint(QFont.Monospace)
        font.setPointSize(10)
        self.log.setFont(font)
        execution_layout.addWidget(self.log, 1)

        execution_nav = QHBoxLayout()
        back_to_transcription = QPushButton("Retour")
        back_to_transcription.clicked.connect(lambda: self.tabs.setCurrentIndex(1))
        go_to_results = QPushButton("Résultats")
        go_to_results.clicked.connect(lambda: self.tabs.setCurrentIndex(3))
        execution_nav.addWidget(back_to_transcription)
        execution_nav.addStretch(1)
        execution_nav.addWidget(go_to_results)
        execution_layout.addLayout(execution_nav)
        self._add_scroll_tab(execution_screen, "Exécution")

        results_screen = QWidget()
        results_screen_layout = QVBoxLayout(results_screen)
        results_screen_layout.setContentsMargins(18, 18, 18, 18)
        results_screen_layout.setSpacing(16)

        self._add_page_header(
            results_screen_layout,
            "Étape 4",
            "Récupérer les résultats",
            "Relis, renomme les locuteurs et ouvre directement les exports de livraison.",
        )

        workspace = QHBoxLayout()
        workspace.setSpacing(14)

        preview_group = QGroupBox("Aperçu de transcription")
        preview_layout = QVBoxLayout(preview_group)
        self.preview_text = QTextEdit()
        self.preview_text.setObjectName("Preview")
        self.preview_text.setReadOnly(True)
        self.preview_text.setPlaceholderText("La transcription lisible apparaîtra ici après exécution.")
        preview_layout.addWidget(self.preview_text)
        workspace.addWidget(preview_group, 2)

        side_panel = QVBoxLayout()
        speakers_group = QGroupBox("Locuteurs")
        self.speakers_layout = QVBoxLayout(speakers_group)
        self.speakers_empty = QLabel("Aucun locuteur détecté.")
        self.speakers_empty.setObjectName("Muted")
        self.speakers_layout.addWidget(self.speakers_empty)
        self.regenerate_btn = QPushButton("Régénérer les exports")
        self.regenerate_btn.setObjectName("Primary")
        self.regenerate_btn.clicked.connect(self.regenerate_outputs)
        self.regenerate_btn.setEnabled(False)
        self.speakers_layout.addWidget(self.regenerate_btn)
        side_panel.addWidget(speakers_group)

        quick_files_group = QGroupBox("Exports prioritaires")
        self.quick_files_layout = QVBoxLayout(quick_files_group)
        self.quick_files_empty = QLabel("Aucun export prioritaire trouvé.")
        self.quick_files_empty.setObjectName("Muted")
        self.quick_files_layout.addWidget(self.quick_files_empty)
        side_panel.addWidget(quick_files_group)
        workspace.addLayout(side_panel, 1)
        results_screen_layout.addLayout(workspace, 1)

        results_group = QGroupBox("Tous les fichiers générés")
        self.results_layout = QVBoxLayout(results_group)
        self.results_empty = QLabel("Aucun résultat pour l'instant.")
        self.results_empty.setObjectName("Muted")
        self.results_layout.addWidget(self.results_empty)
        results_screen_layout.addWidget(results_group)

        history_group = QGroupBox("Historique")
        history_layout = QVBoxLayout(history_group)
        self.history_table = QTableWidget(0, 7)
        self.history_table.setHorizontalHeaderLabels(["Date", "Audio", "Statut", "Langue", "Modèle", "Durée", "Actions"])
        self.history_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.history_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.history_table.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeToContents)
        self.history_table.verticalHeader().setVisible(False)
        self.history_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.history_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.history_table.setAlternatingRowColors(True)
        self.history_table.setShowGrid(False)
        self.history_table.horizontalHeader().setHighlightSections(False)
        self.history_table.setMaximumHeight(260)
        history_layout.addWidget(self.history_table)
        refresh_history_btn = QPushButton("Rafraîchir")
        refresh_history_btn.clicked.connect(self.refresh_history)
        history_layout.addWidget(refresh_history_btn)
        results_screen_layout.addWidget(history_group)

        results_actions = QHBoxLayout()
        new_audio_btn = QPushButton("Nouvelle transcription")
        new_audio_btn.clicked.connect(lambda: self.tabs.setCurrentIndex(0))
        open_output_btn = QPushButton("Ouvrir le dossier output")
        open_output_btn.clicked.connect(self.open_output)
        results_actions.addWidget(new_audio_btn)
        results_actions.addStretch(1)
        results_actions.addWidget(open_output_btn)
        results_screen_layout.addLayout(results_actions)
        self._add_scroll_tab(results_screen, "Résultats")

        settings_screen = QWidget()
        settings_layout = QVBoxLayout(settings_screen)
        settings_layout.setContentsMargins(18, 18, 18, 18)
        settings_layout.setSpacing(16)

        self._add_page_header(
            settings_layout,
            "Paramètres",
            "Hugging Face",
            "Ajoute un token uniquement si la séparation des locuteurs est activée.",
        )

        token_group = QGroupBox("Hugging Face")
        token_form = QFormLayout(token_group)
        self.hf_token = QLineEdit()
        self.hf_token.setEchoMode(QLineEdit.Password)
        self.hf_token.setPlaceholderText("hf_...")
        self.hf_token.textChanged.connect(self._refresh_state)
        self.save_token = QCheckBox("Enregistrer dans .env")
        self.show_token = QCheckBox("Afficher")
        self.show_token.stateChanged.connect(self.toggle_token_visibility)
        self.check_token_btn = QPushButton("Tester le token")
        self.check_token_btn.clicked.connect(self.check_token)
        token_form.addRow("Token HF", self.hf_token)
        token_form.addRow("", self.save_token)
        token_form.addRow("", self.show_token)
        token_form.addRow("", self.check_token_btn)
        token_hint = QLabel("Nécessaire uniquement si la séparation des personnes est activée.")
        token_hint.setObjectName("Muted")
        token_form.addRow("", token_hint)
        settings_layout.addWidget(token_group)
        settings_layout.addStretch(1)

        settings_actions = QHBoxLayout()
        settings_back_btn = QPushButton("Retour transcription")
        settings_back_btn.clicked.connect(lambda: self.tabs.setCurrentIndex(1))
        settings_actions.addStretch(1)
        settings_actions.addWidget(settings_back_btn)
        settings_layout.addLayout(settings_actions)
        self._add_scroll_tab(settings_screen, "Paramètres")

        self.setCentralWidget(central)
        self.setStatusBar(QStatusBar())

        self.setStyleSheet(
            """
            QMainWindow { background: #eef2f7; }
            QMenuBar {
                background: #ffffff;
                border-bottom: 1px solid #d8dee8;
                color: #1f2937;
            }
            QFrame#AppBar {
                background: #0f3b67;
                border-bottom: 1px solid #092742;
            }
            QLabel#BrandMark {
                min-width: 38px;
                min-height: 38px;
                max-width: 38px;
                max-height: 38px;
                border: 1px solid rgba(255, 255, 255, 0.45);
                border-radius: 6px;
                color: #ffffff;
                background: #0f6cbd;
                font-size: 13px;
                font-weight: 800;
            }
            QLabel#AppTitle {
                color: #ffffff;
                font-size: 20px;
                font-weight: 800;
            }
            QLabel#AppSubtitle {
                color: #cfe5ff;
                font-size: 12px;
            }
            QLabel#Muted { color: #65758b; }
            QLabel#Stage { font-weight: 700; color: #263548; }
            QLabel#FieldLabel {
                color: #253246;
                font-weight: 800;
                margin-top: 2px;
            }
            QLabel#PageEyebrow {
                color: #0f6cbd;
                font-size: 11px;
                font-weight: 800;
            }
            QLabel#ScreenTitle {
                color: #111827;
                font-size: 22px;
                font-weight: 800;
            }
            QLabel#Warning {
                color: #8a3b12;
                font-weight: 600;
                background: #fff7ed;
                border: 1px solid #fed7aa;
                border-radius: 5px;
                padding: 8px 10px;
            }
            QFrame#PageHeader {
                background: transparent;
                border: none;
            }
            QTabWidget::pane {
                border: 1px solid #cfd8e3;
                border-left: none;
                border-right: none;
                border-bottom: none;
                background: #ffffff;
                top: -2px;
            }
            QTabBar::tab {
                border: 1px solid #d6dee9;
                border-bottom: none;
                padding: 10px 18px;
                margin-right: 2px;
                background: #f4f7fb;
                color: #344256;
            }
            QTabBar::tab:selected {
                background: #ffffff;
                color: #0f6cbd;
                border-top: 3px solid #0f6cbd;
                font-weight: 800;
            }
            QTabBar::tab:hover:!selected {
                background: #eaf2fb;
            }
            QGroupBox {
                border: 1px solid #d7dee8;
                border-radius: 7px;
                margin-top: 14px;
                padding: 15px;
                background: #ffffff;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 12px;
                padding: 0 6px;
                color: #263548;
                font-weight: 800;
            }
            QLineEdit, QTextEdit {
                border: 1px solid #c9d3df;
                border-radius: 5px;
                padding: 3px 8px;
                background: #ffffff;
                color: #172033;
                selection-background-color: #0f6cbd;
            }
            QLineEdit:focus, QTextEdit:focus {
                border-color: #0f6cbd;
            }
            QLineEdit#CommandPreview {
                background: #f8fafc;
                color: #334155;
                font-family: Consolas, Menlo, monospace;
            }
            QTextEdit#Console {
                background: #0f172a;
                color: #dbeafe;
                border-color: #1e293b;
                font-family: Consolas, Menlo, monospace;
            }
            QTextEdit#Preflight {
                background: #f8fafc;
                color: #334155;
                border-color: #d7dee8;
                font-family: Consolas, Menlo, monospace;
            }
            QTextEdit#Preview {
                background: #fbfdff;
                color: #172033;
                line-height: 1.35;
            }
            QComboBox, QSpinBox {
                min-height: 34px;
                color: #172033;
                background: #ffffff;
            }
            QPushButton {
                border: 1px solid #b8c4d3;
                border-radius: 5px;
                padding: 8px 13px;
                background: #ffffff;
                color: #172033;
                font-weight: 600;
            }
            QPushButton:hover { background: #eef6ff; border-color: #91bde8; }
            QPushButton:disabled {
                color: #8c98a8;
                background: #edf1f6;
                border-color: #d5dce6;
            }
            QPushButton#Primary {
                background: #0f6cbd;
                color: white;
                border-color: #0f6cbd;
                font-weight: 800;
            }
            QPushButton#Primary:hover { background: #0b5da8; }
            QPushButton#Primary:disabled {
                background: #d9e1ec;
                color: #7a8798;
                border-color: #d1dae6;
            }
            QPushButton#CommandButton {
                background: rgba(255, 255, 255, 0.10);
                color: #ffffff;
                border-color: rgba(255, 255, 255, 0.28);
                min-width: 74px;
            }
            QPushButton#CommandButton:hover {
                background: rgba(255, 255, 255, 0.18);
                border-color: rgba(255, 255, 255, 0.55);
            }
            QCheckBox {
                spacing: 8px;
                color: #172033;
            }
            QCheckBox::indicator {
                width: 16px;
                height: 16px;
                border: 1px solid #b8c4d3;
                border-radius: 4px;
                background: #ffffff;
            }
            QCheckBox::indicator:checked {
                background: #0f6cbd;
                border-color: #0f6cbd;
            }
            QCheckBox::indicator:disabled {
                background: #e5e9ef;
                border-color: #d1dae6;
            }
            QProgressBar {
                border: 1px solid #cbd5e1;
                border-radius: 5px;
                height: 12px;
                background: #f8fafc;
                text-align: center;
            }
            QProgressBar::chunk {
                border-radius: 4px;
                background: #22a06b;
            }
            QTableWidget {
                gridline-color: #e4eaf2;
                alternate-background-color: #f8fafc;
                selection-background-color: #dbeafe;
                selection-color: #172033;
            }
            QHeaderView::section {
                background: #f3f6fa;
                color: #344256;
                border: none;
                border-bottom: 1px solid #d7dee8;
                padding: 7px;
                font-weight: 800;
            }
            """
        )

    def _add_page_header(self, layout: QVBoxLayout, eyebrow: str, title: str, description: str) -> None:
        header = QFrame()
        header.setObjectName("PageHeader")
        header_layout = QVBoxLayout(header)
        header_layout.setContentsMargins(0, 0, 0, 4)
        header_layout.setSpacing(3)

        eyebrow_label = QLabel(eyebrow.upper())
        eyebrow_label.setObjectName("PageEyebrow")
        title_label = QLabel(title)
        title_label.setObjectName("ScreenTitle")
        description_label = QLabel(description)
        description_label.setObjectName("Muted")
        description_label.setWordWrap(True)

        header_layout.addWidget(eyebrow_label)
        header_layout.addWidget(title_label)
        header_layout.addWidget(description_label)
        layout.addWidget(header)

    def _add_scroll_tab(self, content: QWidget, title: str) -> None:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setWidget(content)
        self.tabs.addTab(scroll, title)

    def _load_settings(self) -> None:
        env_values = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
        token = env_values.get("HUGGINGFACE_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN", "")
        self.hf_token.setText(token)
        self.audio_path.setText(str(self.settings.value("audio_path", "")))
        preset = self._normalize_preset(str(self.settings.value("preset", PRESET_QUALITY)))
        self.preset.setCurrentText(preset)
        self.model.setCurrentText(str(self.settings.value("model", "large-v3")))
        saved_language = str(self.settings.value("language", "Français"))
        self.language.setCurrentText(saved_language if saved_language in LANGUAGES else "Français")
        self.asr_backend.setCurrentText(str(self.settings.value("asr_backend", "auto")))
        self.audio_filter.setCurrentText(str(self.settings.value("audio_filter", "loudnorm")))
        self.trim_silence.setChecked(str(self.settings.value("trim_silence", "false")).lower() == "true")
        self.force_recompute.setChecked(str(self.settings.value("force_recompute", "false")).lower() == "true")
        self.batch_size.setValue(int(self.settings.value("batch_size", 8)))
        self.threads.setValue(int(self.settings.value("threads", 0)))
        self.speaker_mode.setCurrentText(str(self.settings.value("speaker_mode", "Auto")))
        self.speakers.setValue(int(self.settings.value("speakers", 3)))
        self.min_speakers.setValue(int(self.settings.value("min_speakers", 2)))
        self.max_speakers.setValue(int(self.settings.value("max_speakers", 5)))
        self.speaker_names.setText(str(self.settings.value("speaker_names", "")))
        saved_diarization = str(self.settings.value("diarization", "true")).lower() == "true"
        self.diarization.setChecked(False if preset == PRESET_NO_SPEAKERS else saved_diarization)
        self.advanced_toggle.setChecked(str(self.settings.value("advanced", "false")).lower() == "true")
        self._update_preset_description()
        self._toggle_advanced()

    def _normalize_preset(self, value: str) -> str:
        if value in PRESET_LABELS:
            return value
        return OLD_PRESET_NAMES.get(value, PRESET_QUALITY)

    def _save_settings(self) -> None:
        self.settings.setValue("audio_path", self.audio_path.text().strip())
        self.settings.setValue("preset", self.preset.currentText())
        self.settings.setValue("diarization", self.diarization.isChecked())
        self.settings.setValue("advanced", self.advanced_toggle.isChecked())
        self.settings.setValue("model", self.model.currentText())
        self.settings.setValue("language", self.language.currentText())
        self.settings.setValue("asr_backend", self.asr_backend.currentText())
        self.settings.setValue("audio_filter", self.audio_filter.currentText())
        self.settings.setValue("trim_silence", self.trim_silence.isChecked())
        self.settings.setValue("force_recompute", self.force_recompute.isChecked())
        self.settings.setValue("batch_size", self.batch_size.value())
        self.settings.setValue("threads", self.threads.value())
        self.settings.setValue("speaker_mode", self.speaker_mode.currentText())
        self.settings.setValue("speakers", self.speakers.value())
        self.settings.setValue("min_speakers", self.min_speakers.value())
        self.settings.setValue("max_speakers", self.max_speakers.value())
        self.settings.setValue("speaker_names", self.speaker_names.text().strip())
        if self.save_token.isChecked() and self.hf_token.text().strip():
            ENV_PATH.touch(exist_ok=True)
            set_key(str(ENV_PATH), "HUGGINGFACE_TOKEN", self.hf_token.text().strip())

    def _apply_preset(self, *_args) -> None:
        preset = self.preset.currentText()
        self._update_preset_description()
        if preset == PRESET_FAST:
            self.model.setCurrentText("large-v3-turbo")
            self.batch_size.setValue(12)
            self.device.setCurrentText("auto")
            self.compute_type.setCurrentText("auto")
            self.diarization.setChecked(True)
        elif preset == PRESET_CPU:
            self.model.setCurrentText("medium")
            self.batch_size.setValue(4)
            self.device.setCurrentText("cpu")
            self.compute_type.setCurrentText("int8")
            self.diarization.setChecked(True)
        elif preset == PRESET_NO_SPEAKERS:
            self.model.setCurrentText("large-v3")
            self.batch_size.setValue(8)
            self.device.setCurrentText("auto")
            self.compute_type.setCurrentText("auto")
            self.diarization.setChecked(False)
        elif preset == PRESET_AUTO:
            self.preset.blockSignals(True)
            self.preset.setCurrentText(recommended_preset())
            self.preset.blockSignals(False)
            self._apply_preset()
            return
        else:
            self.model.setCurrentText("large-v3")
            self.batch_size.setValue(8)
            self.device.setCurrentText("auto")
            self.compute_type.setCurrentText("auto")
            self.diarization.setChecked(True)
        self._refresh_state()

    def _update_preset_description(self) -> None:
        self.preset_description.setText(PRESET_DESCRIPTIONS.get(self.preset.currentText(), ""))

    def recommended_backend_label(self) -> str:
        if platform.system() == "Darwin" and platform.machine() == "arm64":
            return "MLX sur Apple Silicon si mlx-whisper est installé"
        if shutil.which("nvidia-smi"):
            return "CUDA sur GPU NVIDIA"
        return "CPU avec profil prudent"

    def run_preflight(self) -> None:
        if self.preflight_process is not None:
            QMessageBox.warning(self, "Vérification", "Une vérification est déjà en cours.")
            return
        python = venv_python()
        local_checks = [
            ("venv", python.exists(), str(python)),
            ("FFmpeg", shutil.which("ffmpeg") is not None, shutil.which("ffmpeg") or "introuvable dans PATH"),
        ]
        lines = [f"Backend recommandé: {self.recommended_backend_label()}"]
        for name, ok, detail in local_checks:
            lines.append(f"{'OK' if ok else 'MANQUANT'} - {name}: {detail}")
        if not python.exists():
            lines.append(f"Action: lance {setup_command()} puis relance cette vérification.")
            self.preflight_output.setPlainText("\n".join(lines))
            return

        self.preflight_output.setPlainText("\n".join(lines + ["Vérification des dépendances Python..."]))
        self.preflight_btn.setEnabled(False)
        self.preflight_process = QProcess(self)
        self.preflight_process.setProgram(str(python))
        self.preflight_process.setArguments(["-u", str(TRANSCRIBE), "--doctor"])
        self.preflight_process.setWorkingDirectory(str(ROOT))
        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        self.preflight_process.setProcessEnvironment(env)
        self.preflight_process.finished.connect(self.preflight_doctor_finished)
        self.preflight_process.start()

    def preflight_doctor_finished(self, exit_code: int, _exit_status: QProcess.ExitStatus) -> None:
        output = ""
        if self.preflight_process:
            stdout = bytes(self.preflight_process.readAllStandardOutput()).decode("utf-8", errors="replace")
            stderr = bytes(self.preflight_process.readAllStandardError()).decode("utf-8", errors="replace")
            output = (stdout + stderr).strip()
        self.preflight_process = None
        current = self.preflight_output.toPlainText()
        self.preflight_output.setPlainText((current + "\n\n" + (output or "Doctor terminé.")).strip())
        if exit_code != 0:
            self.preflight_btn.setEnabled(True)
            self.statusBar().showMessage("Vérification échouée.")
            return
        if self.diarization.isChecked():
            if not self.hf_token.text().strip():
                self.preflight_output.append("\nMANQUANT - Token HF requis pour pyannote.")
                self.preflight_btn.setEnabled(True)
                return
            self.preflight_output.append("\nVérification du token HF et des modèles pyannote...")
            self.preflight_process = QProcess(self)
            self.preflight_process.setProgram(str(venv_python()))
            self.preflight_process.setArguments(["-u", str(TRANSCRIBE), "--check-token"])
            self.preflight_process.setWorkingDirectory(str(ROOT))
            env = QProcessEnvironment.systemEnvironment()
            env.insert("PYTHONUNBUFFERED", "1")
            env.insert("HUGGINGFACE_TOKEN", self.hf_token.text().strip())
            self.preflight_process.setProcessEnvironment(env)
            self.preflight_process.finished.connect(self.preflight_token_finished)
            self.preflight_process.start()
            return
        self.preflight_btn.setEnabled(True)
        self.statusBar().showMessage("Vérification terminée.")

    def preflight_token_finished(self, exit_code: int, _exit_status: QProcess.ExitStatus) -> None:
        output = ""
        if self.preflight_process:
            stdout = bytes(self.preflight_process.readAllStandardOutput()).decode("utf-8", errors="replace")
            stderr = bytes(self.preflight_process.readAllStandardError()).decode("utf-8", errors="replace")
            output = (stdout + stderr).strip()
        self.preflight_process = None
        self.preflight_btn.setEnabled(True)
        self.preflight_output.append("\n" + (output or "Test token terminé."))
        self.statusBar().showMessage("Vérification terminée." if exit_code == 0 else "Vérification token échouée.")

    def _toggle_advanced(self, *_args) -> None:
        self.advanced_group.setVisible(self.advanced_toggle.isChecked())
        self._refresh_state()

    def _toggle_command_preview(self) -> None:
        visible = not self.command_preview.isVisible()
        self.command_preview.setVisible(visible)
        self.command_toggle.setText("Masquer la commande" if visible else "Afficher la commande")

    def _refresh_state(self) -> None:
        has_audio = bool(self.audio_path.text().strip())
        no_speakers_preset = self.preset.currentText() == PRESET_NO_SPEAKERS
        if no_speakers_preset and self.diarization.isChecked():
            self.diarization.blockSignals(True)
            self.diarization.setChecked(False)
            self.diarization.blockSignals(False)
        needs_token = self.diarization.isChecked()
        has_token = bool(self.hf_token.text().strip())
        is_running = self.process is not None

        self.start_btn.setEnabled(has_audio and (not needs_token or has_token) and not is_running)
        self.stop_btn.setEnabled(is_running)
        self.next_audio_btn.setEnabled(has_audio and not is_running)
        self.next_transcription_btn.setEnabled(has_audio and not is_running)
        self.hf_token.setEnabled(not is_running)
        self.save_token.setEnabled(not is_running)
        self.show_token.setEnabled(not is_running)
        self.check_token_btn.setEnabled(not is_running and self.token_process is None)
        self.preflight_btn.setEnabled(not is_running and self.preflight_process is None)
        self.speaker_mode.setEnabled(needs_token and not is_running)
        for widget in (self.speaker_mode_label, self.speaker_mode):
            widget.setVisible(needs_token)

        exact = needs_token and self.speaker_mode.currentText() == "Nombre exact"
        speaker_range = needs_token and self.speaker_mode.currentText() == "Fourchette"
        self.speakers.setEnabled(exact and not is_running)
        self.min_speakers.setEnabled(speaker_range and not is_running)
        self.max_speakers.setEnabled(speaker_range and not is_running)
        self.speakers.setVisible(exact)
        self.speakers_label.setVisible(exact)
        self.min_speakers.setVisible(speaker_range)
        self.min_speakers_label.setVisible(speaker_range)
        self.max_speakers.setVisible(speaker_range)
        self.max_speakers_label.setVisible(speaker_range)
        self.diarization.setEnabled(not is_running and not no_speakers_preset)
        self.speaker_names.setEnabled(not is_running)
        self.preset.setEnabled(not is_running)
        self.advanced_toggle.setEnabled(not is_running)
        self.command_toggle.setEnabled(has_audio)

        self.command_preview.setText(" ".join(self._build_args(mask_token=True)) if has_audio else "")
        if needs_token and not has_token:
            self.settings_hint.setText("Token HF manquant: va dans l'onglet Paramètres pour activer la séparation des personnes.")
            self.execution_hint.setText("Impossible de lancer avec séparation des personnes sans token HF. Configure Paramètres ou désactive la séparation.")
        else:
            self.settings_hint.setText("")
            self.execution_hint.setText("")
        self.settings_hint.setVisible(bool(self.settings_hint.text()))
        self.execution_hint.setVisible(bool(self.execution_hint.text()))

        if is_running:
            self.statusBar().showMessage("Transcription en cours...")
        elif not has_audio:
            self.statusBar().showMessage("Sélectionne un fichier audio.")
        elif needs_token and not has_token:
            self.statusBar().showMessage("Token Hugging Face requis dans Paramètres pour séparer les locuteurs.")
        else:
            self.statusBar().showMessage("Prêt.")

    def choose_file(self) -> None:
        start_dir = str(Path(self.audio_path.text()).parent) if self.audio_path.text().strip() else str(INPUT_DIR)
        filename, _ = QFileDialog.getOpenFileName(self, "Choisir un fichier audio", start_dir, AUDIO_FILTER)
        if filename:
            self.audio_path.setText(filename)

    def use_latest_input(self) -> None:
        candidates: list[Path] = []
        for pattern in (f"*{suffix}" for suffix in SUPPORTED_AUDIO_EXTENSIONS):
            candidates.extend(INPUT_DIR.rglob(pattern))
        if not candidates:
            QMessageBox.warning(self, "Aucun fichier", f"Aucun fichier audio trouvé dans {INPUT_DIR}.")
            return
        latest = max(candidates, key=lambda path: path.stat().st_mtime)
        self.audio_path.setText(str(latest))

    def toggle_token_visibility(self) -> None:
        self.hf_token.setEchoMode(QLineEdit.Normal if self.show_token.isChecked() else QLineEdit.Password)

    def check_token(self) -> None:
        if self.process is not None or self.token_process is not None:
            QMessageBox.warning(self, "Process en cours", "Attends la fin du traitement en cours.")
            return
        if not self.hf_token.text().strip():
            QMessageBox.warning(self, "Token HF", "Renseigne un token Hugging Face avant le test.")
            return
        python = venv_python()
        if not python.exists():
            QMessageBox.critical(self, "Environnement", f"L'environnement .venv est introuvable. Lance {setup_command()}")
            return
        self.statusBar().showMessage("Test du token Hugging Face...")
        self.check_token_btn.setEnabled(False)
        self.token_process = QProcess(self)
        self.token_process.setProgram(str(python))
        self.token_process.setArguments(["-u", str(TRANSCRIBE), "--check-token"])
        self.token_process.setWorkingDirectory(str(ROOT))
        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        env.insert("HUGGINGFACE_TOKEN", self.hf_token.text().strip())
        self.token_process.setProcessEnvironment(env)
        self.token_process.finished.connect(self.token_check_finished)
        self.token_process.start()

    def token_check_finished(self, exit_code: int, _exit_status: QProcess.ExitStatus) -> None:
        output = ""
        if self.token_process:
            stdout = bytes(self.token_process.readAllStandardOutput()).decode("utf-8", errors="replace")
            stderr = bytes(self.token_process.readAllStandardError()).decode("utf-8", errors="replace")
            output = (stdout + stderr).strip()
        self.token_process = None
        self.check_token_btn.setEnabled(True)
        if exit_code == 0:
            self.statusBar().showMessage("Token Hugging Face valide.")
            QMessageBox.information(self, "Token HF", "Token valide pour pyannote.")
        else:
            self.statusBar().showMessage("Token Hugging Face invalide ou non autorisé.")
            QMessageBox.critical(self, "Token HF", output or "Le test du token a échoué.")

    def _build_args(self, mask_token: bool = False) -> list[str]:
        args = [
            str(TRANSCRIBE),
            "--audio",
            self.audio_path.text().strip(),
            "--output-dir",
            str(OUTPUT_DIR),
            "--work-dir",
            str(WORK_DIR),
            "--model",
            self.model.currentText(),
            "--asr-backend",
            self.asr_backend.currentText(),
            "--language",
            LANGUAGES[self.language.currentText()],
            "--audio-filter",
            self.audio_filter.currentText(),
            "--batch-size",
            str(self.batch_size.value()),
            "--threads",
            str(self.threads.value()),
            "--device",
            self.device.currentText(),
            "--compute-type",
            self.compute_type.currentText(),
        ]
        if self.trim_silence.isChecked():
            args.append("--trim-silence")
        if self.force_recompute.isChecked():
            args.append("--force")
        if self.speaker_names.text().strip():
            args.extend(["--speaker-map", self.speaker_names.text().strip()])
        if self.diarization.isChecked():
            if self.speaker_mode.currentText() == "Nombre exact":
                args.extend(["--speakers", str(self.speakers.value())])
            elif self.speaker_mode.currentText() == "Fourchette":
                args.extend(["--min-speakers", str(self.min_speakers.value())])
                args.extend(["--max-speakers", str(self.max_speakers.value())])
        else:
            args.append("--no-diarization")
        return args

    def start_transcription(self) -> None:
        audio = Path(self.audio_path.text().strip())
        if not audio.exists():
            QMessageBox.critical(self, "Fichier introuvable", f"Le fichier n'existe pas:\n{audio}")
            return
        if self.min_speakers.value() > self.max_speakers.value():
            QMessageBox.critical(self, "Locuteurs", "Le minimum doit être inférieur ou égal au maximum.")
            return
        if self.device.currentText() == "cpu" and self.model.currentText() == "large-v3":
            answer = QMessageBox.question(
                self,
                "Transcription lente",
                "large-v3 sur CPU peut prendre longtemps. Continuer ?",
                QMessageBox.Yes | QMessageBox.No,
            )
            if answer != QMessageBox.Yes:
                return
        python = venv_python()
        if not python.exists():
            QMessageBox.critical(
                self,
                "Environnement",
                f"L'environnement .venv est introuvable. Lance {setup_command()}",
            )
            return

        self._save_settings()
        self.log.clear()
        self._clear_results()
        self._set_running_ui(True, "Préparation...")
        self.tabs.setCurrentIndex(2)
        self.append_log("Commande:\n" + " ".join(self._build_args(mask_token=True)) + "\n")

        self.process = QProcess(self)
        self.process.setProgram(str(python))
        self.process.setArguments(["-u", *self._build_args(mask_token=False)])
        self.process.setWorkingDirectory(str(ROOT))
        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        if self.hf_token.text().strip():
            env.insert("HUGGINGFACE_TOKEN", self.hf_token.text().strip())
        self.process.setProcessEnvironment(env)
        self.process.readyReadStandardOutput.connect(self.read_stdout)
        self.process.readyReadStandardError.connect(self.read_stderr)
        self.process.finished.connect(self.process_finished)
        self.process.errorOccurred.connect(self.process_error)
        self.process.start()
        self._refresh_state()

    def stop_transcription(self) -> None:
        if self.process:
            self.append_log("\nArrêt demandé...\n")
            self.process.kill()

    def read_stdout(self) -> None:
        if self.process:
            self.append_log(bytes(self.process.readAllStandardOutput()).decode("utf-8", errors="replace"))

    def read_stderr(self) -> None:
        if self.process:
            self.append_log(bytes(self.process.readAllStandardError()).decode("utf-8", errors="replace"))

    def process_finished(self, exit_code: int, _exit_status: QProcess.ExitStatus) -> None:
        self.append_log(f"\nProcess terminé avec code {exit_code}.\n")
        self.process = None
        self._set_running_ui(False, "Terminé." if exit_code == 0 else "Échec.", complete=exit_code == 0)
        self._refresh_state()
        if exit_code == 0:
            self.statusBar().showMessage("Terminé. Les fichiers sont dans output.")
            self._show_results()
            self.refresh_history()
            self.tabs.setCurrentIndex(3)
        else:
            self.statusBar().showMessage("Échec. Regarde le journal.")

    def process_error(self, error: QProcess.ProcessError) -> None:
        self.append_log(f"\nErreur Qt process: {error.name}\n")

    def append_log(self, text: str) -> None:
        self._update_stage_from_log(text)
        self.log.moveCursor(QTextCursor.End)
        self.log.insertPlainText(text)
        self.log.moveCursor(QTextCursor.End)

    def _set_running_ui(self, running: bool, stage: str, complete: bool = False) -> None:
        self.stage_label.setText(stage)
        if running:
            self.elapsed_seconds = 0
            self.elapsed_label.setText("00:00")
            self.progress.setRange(0, 100)
            self.progress.setValue(5)
            self.elapsed_timer.start(1000)
        else:
            self.progress.setRange(0, 100)
            self.progress.setValue(100 if complete else 0)
            self.elapsed_timer.stop()

    def _tick_elapsed(self) -> None:
        self.elapsed_seconds += 1
        minutes, seconds = divmod(self.elapsed_seconds, 60)
        self.elapsed_label.setText(f"{minutes:02d}:{seconds:02d}")

    def _update_stage_from_log(self, text: str) -> None:
        stages = (
            ("Preparing clean", "Préparation audio...", 10),
            ("Using existing preprocessed WAV", "Audio préparé déjà disponible.", 15),
            ("Loading ASR model", "Chargement du modèle...", 25),
            ("Transcribing", "Transcription...", 45),
            ("Aligning timestamps", "Alignement temporel...", 65),
            ("Running speaker diarization", "Séparation des locuteurs...", 82),
            ("Diarization skipped", "Séparation ignorée.", 82),
            ("Done. Files written", "Écriture des résultats...", 95),
        )
        for needle, label, value in stages:
            if needle in text:
                self.stage_label.setText(label)
                self.progress.setValue(value)

    def _expected_outputs(self) -> list[Path]:
        audio_text = self.audio_path.text().strip()
        if not audio_text:
            return []
        return expected_output_paths(Path(audio_text), OUTPUT_DIR)

    def _expected_output_by_suffix(self, suffix: str) -> Path | None:
        for path in self._expected_outputs():
            if path.name.endswith(suffix):
                return path
        return None

    def _clear_layout(self, layout: QVBoxLayout) -> None:
        while layout.count():
            item = layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
            child_layout = item.layout()
            if child_layout:
                self._clear_layout(child_layout)

    def _clear_results(self) -> None:
        self._clear_layout(self.results_layout)
        self.results_empty = QLabel("Aucun résultat pour l'instant.")
        self.results_empty.setObjectName("Muted")
        self.results_layout.addWidget(self.results_empty)
        self._clear_layout(self.speakers_layout)
        self.speaker_inputs = {}
        self.speakers_empty = QLabel("Aucun locuteur détecté.")
        self.speakers_empty.setObjectName("Muted")
        self.speakers_layout.addWidget(self.speakers_empty)
        self.regenerate_btn = QPushButton("Régénérer les exports")
        self.regenerate_btn.setObjectName("Primary")
        self.regenerate_btn.clicked.connect(self.regenerate_outputs)
        self.regenerate_btn.setEnabled(False)
        self.speakers_layout.addWidget(self.regenerate_btn)
        self._clear_layout(self.quick_files_layout)
        self.quick_files_empty = QLabel("Aucun export prioritaire trouvé.")
        self.quick_files_empty.setObjectName("Muted")
        self.quick_files_layout.addWidget(self.quick_files_empty)
        self.preview_text.clear()

    def _show_results(self) -> None:
        self._clear_results()
        paths = [path for path in self._expected_outputs() if path.exists()]
        if not paths:
            self.results_empty.setText("Terminé, mais aucun fichier attendu n'a été trouvé dans output.")
            return

        self.results_layout.takeAt(0).widget().deleteLater()
        for path in paths:
            row = QFrame()
            row_layout = QHBoxLayout(row)
            row_layout.setContentsMargins(0, 0, 0, 0)
            name = QLabel(path.name)
            row_layout.addWidget(name, 1)
            open_btn = QPushButton("Ouvrir")
            open_btn.clicked.connect(lambda _checked=False, p=path: self.open_file(p))
            copy_btn = QPushButton("Copier le chemin")
            copy_btn.clicked.connect(lambda _checked=False, p=path: QApplication.clipboard().setText(str(p)))
            row_layout.addWidget(open_btn)
            row_layout.addWidget(copy_btn)
            self.results_layout.addWidget(row)
        self._load_preview()
        self._load_speakers()
        self._load_quick_files()

    def _load_segments_data(self) -> dict:
        segments_path = self._expected_output_by_suffix(".segments.json")
        if not segments_path or not segments_path.exists():
            return {}
        try:
            with segments_path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, json.JSONDecodeError):
            return {}

    def _load_preview(self) -> None:
        preview_path = self._expected_output_by_suffix(".speaker-turns.md") or self._expected_output_by_suffix(".clean.txt")
        if preview_path and preview_path.exists():
            self.preview_text.setPlainText(preview_path.read_text(encoding="utf-8", errors="replace")[:20000])
        else:
            self.preview_text.setPlainText("Aucun aperçu disponible.")

    def _load_speakers(self) -> None:
        data = self._load_segments_data()
        speakers = sorted(
            {
                str(item.get("speaker"))
                for item in data.get("turns", []) + data.get("segments", [])
                if item.get("speaker")
            }
        )
        if not speakers:
            return
        self._clear_layout(self.speakers_layout)
        self.speaker_inputs = {}
        for speaker in speakers:
            row = QHBoxLayout()
            label = QLabel(speaker)
            field = QLineEdit()
            field.setPlaceholderText(speaker)
            if not speaker.startswith("SPEAKER_"):
                field.setText(speaker)
            row.addWidget(label)
            row.addWidget(field, 1)
            self.speakers_layout.addLayout(row)
            self.speaker_inputs[speaker] = field
        self.regenerate_btn = QPushButton("Régénérer les exports")
        self.regenerate_btn.setObjectName("Primary")
        self.regenerate_btn.clicked.connect(self.regenerate_outputs)
        self.regenerate_btn.setEnabled(True)
        self.speakers_layout.addWidget(self.regenerate_btn)

    def _load_quick_files(self) -> None:
        wanted = (
            (".transcript.docx", "DOCX"),
            (".speaker-turns.md", "Markdown"),
            (".speaker-segments.srt", "SRT"),
        )
        rows = []
        for suffix, label in wanted:
            path = self._expected_output_by_suffix(suffix)
            if path and path.exists():
                rows.append((label, path))
        if not rows:
            return
        self._clear_layout(self.quick_files_layout)
        for label, path in rows:
            row = QHBoxLayout()
            row.addWidget(QLabel(label))
            open_btn = QPushButton("Ouvrir")
            open_btn.clicked.connect(lambda _checked=False, p=path: self.open_file(p))
            row.addWidget(open_btn)
            self.quick_files_layout.addLayout(row)

    def speaker_map_text_from_fields(self) -> str:
        items = []
        for speaker, field in self.speaker_inputs.items():
            value = field.text().strip()
            if value and value != speaker:
                items.append(f"{speaker}={value}")
        return ",".join(items)

    def regenerate_outputs(self) -> None:
        speaker_map = self.speaker_map_text_from_fields()
        if not speaker_map:
            QMessageBox.information(self, "Locuteurs", "Renseigne au moins un nouveau nom de locuteur.")
            return
        audio = self.audio_path.text().strip()
        if not audio:
            QMessageBox.warning(self, "Audio", "Aucun fichier audio associé aux résultats.")
            return
        python = venv_python()
        if not python.exists():
            QMessageBox.critical(self, "Environnement", f"L'environnement .venv est introuvable. Lance {setup_command()}")
            return
        if self.regenerate_process is not None:
            QMessageBox.warning(self, "Régénération", "Une régénération est déjà en cours.")
            return
        self.regenerate_btn.setEnabled(False)
        self.statusBar().showMessage("Régénération des exports...")
        self.regenerate_process = QProcess(self)
        self.regenerate_process.setProgram(str(python))
        self.regenerate_process.setArguments(
            [
                "-u",
                str(TRANSCRIBE),
                "--audio",
                audio,
                "--output-dir",
                str(OUTPUT_DIR),
                "--work-dir",
                str(WORK_DIR),
                "--rename-only",
                "--speaker-map",
                speaker_map,
            ]
        )
        self.regenerate_process.setWorkingDirectory(str(ROOT))
        env = QProcessEnvironment.systemEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        if self.hf_token.text().strip():
            env.insert("HUGGINGFACE_TOKEN", self.hf_token.text().strip())
        self.regenerate_process.setProcessEnvironment(env)
        self.regenerate_process.finished.connect(self.regenerate_finished)
        self.regenerate_process.start()

    def regenerate_finished(self, exit_code: int, _exit_status: QProcess.ExitStatus) -> None:
        output = ""
        if self.regenerate_process:
            stdout = bytes(self.regenerate_process.readAllStandardOutput()).decode("utf-8", errors="replace")
            stderr = bytes(self.regenerate_process.readAllStandardError()).decode("utf-8", errors="replace")
            output = (stdout + stderr).strip()
        self.regenerate_process = None
        self.regenerate_btn.setEnabled(True)
        if exit_code == 0:
            self.statusBar().showMessage("Exports régénérés.")
            self._show_results()
            self.refresh_history()
        else:
            self.statusBar().showMessage("Échec de régénération.")
            QMessageBox.critical(self, "Régénération", output or "La régénération a échoué.")

    def refresh_history(self) -> None:
        self.history_records = self.load_history_records()
        visible_records = self.history_records[-20:][::-1]
        self.history_table.setRowCount(len(visible_records))
        for row, record in enumerate(visible_records):
            values = [
                self.format_history_date(str(record.get("created_at", ""))),
                Path(record.get("source_audio", "")).name,
                str(record.get("status", "")),
                str(record.get("language", "")),
                str(record.get("model", "")),
                self.format_duration(record.get("duration_seconds")),
            ]
            for column, value in enumerate(values):
                self.history_table.setItem(row, column, QTableWidgetItem(value))
            actions = QWidget()
            layout = QHBoxLayout(actions)
            layout.setContentsMargins(0, 0, 0, 0)
            for label, callback in (
                ("Ouvrir", self.open_history_record),
                ("Relancer", self.relaunch_history_record),
                ("Renommer", self.rename_history_record),
                ("Supprimer", self.delete_history_record),
            ):
                button = QPushButton(label)
                button.clicked.connect(lambda _checked=False, r=record, cb=callback: cb(r))
                layout.addWidget(button)
            self.history_table.setCellWidget(row, 6, actions)

    def load_history_records(self) -> list[dict]:
        history_path = OUTPUT_DIR / "transcription-history.jsonl"
        if not history_path.exists():
            return []
        records = []
        with history_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return records

    def write_history_records(self, records: list[dict]) -> None:
        history_path = OUTPUT_DIR / "transcription-history.jsonl"
        with history_path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    def format_history_date(self, value: str) -> str:
        return value.replace("T", " ").split(".")[0].replace("+00:00", "")

    def format_duration(self, value) -> str:
        if value is None:
            return ""
        try:
            total = int(round(float(value)))
        except (TypeError, ValueError):
            return ""
        minutes, seconds = divmod(total, 60)
        hours, minutes = divmod(minutes, 60)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    def open_history_record(self, record: dict) -> None:
        outputs = [Path(path) for path in record.get("outputs", [])]
        first_existing = next((path for path in outputs if path.exists()), None)
        if first_existing:
            self.open_file(first_existing)
        else:
            self.open_output()

    def relaunch_history_record(self, record: dict) -> None:
        audio = Path(record.get("source_audio", ""))
        if not audio.exists():
            QMessageBox.warning(self, "Historique", f"Fichier audio introuvable:\n{audio}")
            return
        self.audio_path.setText(str(audio))
        self.model.setCurrentText(str(record.get("model", self.model.currentText())))
        language = str(record.get("language", "fr"))
        for label, code in LANGUAGES.items():
            if code == language:
                self.language.setCurrentText(label)
                break
        self.tabs.setCurrentIndex(2)

    def rename_history_record(self, record: dict) -> None:
        audio = Path(record.get("source_audio", ""))
        if not audio.exists():
            QMessageBox.warning(self, "Historique", f"Fichier audio introuvable:\n{audio}")
            return
        self.audio_path.setText(str(audio))
        self._show_results()
        self.tabs.setCurrentIndex(3)

    def delete_history_record(self, record: dict) -> None:
        answer = QMessageBox.question(
            self,
            "Supprimer",
            "Supprimer cette entrée d'historique et les fichiers générés encore présents ?",
            QMessageBox.Yes | QMessageBox.No,
        )
        if answer != QMessageBox.Yes:
            return
        for output in record.get("outputs", []):
            Path(output).unlink(missing_ok=True)
        remaining = [item for item in self.history_records if item is not record]
        self.write_history_records(remaining)
        self.refresh_history()
        self._show_results()

    def open_file(self, path: Path) -> None:
        QDesktopServices.openUrl(path.resolve().as_uri())

    def open_output(self) -> None:
        self.open_folder(OUTPUT_DIR)

    def open_folder(self, folder: Path) -> None:
        folder.mkdir(exist_ok=True)
        QDesktopServices.openUrl(folder.resolve().as_uri())

    def dragEnterEvent(self, event) -> None:  # type: ignore[override]
        if event.mimeData().hasUrls():
            for url in event.mimeData().urls():
                if Path(url.toLocalFile()).suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS:
                    event.acceptProposedAction()
                    return
        event.ignore()

    def dropEvent(self, event) -> None:  # type: ignore[override]
        for url in event.mimeData().urls():
            path = Path(url.toLocalFile())
            if path.suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS:
                self.audio_path.setText(str(path))
                event.acceptProposedAction()
                return

    def closeEvent(self, event) -> None:  # type: ignore[override]
        if self.process is not None:
            answer = QMessageBox.question(
                self,
                "Transcription en cours",
                "Arrêter la transcription et fermer ?",
                QMessageBox.Yes | QMessageBox.No,
            )
            if answer != QMessageBox.Yes:
                event.ignore()
                return
            self.process.kill()
        self._save_settings()
        event.accept()


def main() -> int:
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    app.setApplicationName("WhisperX Transcription")
    app.setWindowIcon(QIcon())
    window = TranscriptionWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
