from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from dotenv import dotenv_values, set_key
from PySide6.QtCore import QProcess, QProcessEnvironment, QSettings, QTimer
from PySide6.QtGui import QAction, QDesktopServices, QFont, QIcon, QTextCursor
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QComboBox,
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
    QSpinBox,
    QStatusBar,
    QTabWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


ROOT = Path(__file__).resolve().parent
INPUT_DIR = ROOT / "input"
OUTPUT_DIR = ROOT / "output"
WORK_DIR = ROOT / "work"
ENV_PATH = ROOT / ".env"
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
TRANSCRIBE = ROOT / "transcribe.py"
AUDIO_FILTER = "Audio (*.m4a *.mp3 *.wav *.mp4 *.webm *.flac *.ogg);;Tous les fichiers (*.*)"
PRESET_QUALITY = "Qualite max (large-v3)"
PRESET_FAST = "Rapide (large-v3-turbo)"
PRESET_CPU = "CPU leger (medium + int8)"
PRESET_NO_SPEAKERS = "Sans locuteurs (large-v3, no diarization)"
PRESET_LABELS = [PRESET_QUALITY, PRESET_FAST, PRESET_CPU, PRESET_NO_SPEAKERS]
PRESET_DESCRIPTIONS = {
    PRESET_QUALITY: "Le meilleur choix par defaut: precision prioritaire, plus lent sur CPU.",
    PRESET_FAST: "Plus rapide, avec une petite concession possible sur la qualite.",
    PRESET_CPU: "Profil prudent pour une machine sans GPU ou avec peu de memoire.",
    PRESET_NO_SPEAKERS: "Transcrit seulement le texte: pas de token HF, pas de separation par personne.",
}
OLD_PRESET_NAMES = {
    "Meilleure qualite": PRESET_QUALITY,
    "Rapide": PRESET_FAST,
    "CPU prudent": PRESET_CPU,
    "Sans separation": PRESET_NO_SPEAKERS,
}


def slugify(value: str) -> str:
    value = re.sub(r"[^\w.-]+", "_", value, flags=re.UNICODE).strip("_.")
    return value or "audio"


class TranscriptionWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.process: QProcess | None = None
        self.elapsed_seconds = 0
        self.settings = QSettings("Codex", "WhisperLocalTranscriber")
        INPUT_DIR.mkdir(exist_ok=True)
        OUTPUT_DIR.mkdir(exist_ok=True)
        WORK_DIR.mkdir(exist_ok=True)

        self.setWindowTitle("Transcription WhisperX")
        self.setMinimumSize(980, 720)
        self.setAcceptDrops(True)
        self.elapsed_timer = QTimer(self)
        self.elapsed_timer.timeout.connect(self._tick_elapsed)
        self._build_ui()
        self._load_settings()
        self._refresh_state()

    def _build_ui(self) -> None:
        central = QWidget()
        root = QVBoxLayout(central)
        root.setContentsMargins(18, 18, 18, 18)
        root.setSpacing(14)

        header = QHBoxLayout()
        title_wrap = QVBoxLayout()
        title = QLabel("Transcription WhisperX")
        title_font = QFont()
        title_font.setPointSize(18)
        title_font.setBold(True)
        title.setFont(title_font)
        subtitle = QLabel("Audio francais, diarisation et exports propres en local.")
        subtitle.setObjectName("Muted")
        title_wrap.addWidget(title)
        title_wrap.addWidget(subtitle)
        header.addLayout(title_wrap)
        header.addStretch(1)

        self.open_input_btn = QPushButton("Ouvrir input")
        self.open_input_btn.clicked.connect(lambda: self.open_folder(INPUT_DIR))
        header.addWidget(self.open_input_btn)
        self.open_output_btn = QPushButton("Ouvrir output")
        self.open_output_btn.clicked.connect(self.open_output)
        header.addWidget(self.open_output_btn)
        root.addLayout(header)

        self.tabs = QTabWidget()
        self.tabs.setTabPosition(QTabWidget.North)
        root.addWidget(self.tabs, 1)

        audio_screen = QWidget()
        audio_layout = QVBoxLayout(audio_screen)
        audio_layout.setContentsMargins(18, 18, 18, 18)
        audio_layout.setSpacing(16)

        audio_title = QLabel("1. Choisir l'audio")
        audio_title.setObjectName("ScreenTitle")
        audio_layout.addWidget(audio_title)

        audio_intro = QLabel("Selectionne un fichier source ou prends automatiquement le plus recent dans input.")
        audio_intro.setObjectName("Muted")
        audio_layout.addWidget(audio_intro)

        file_group = QGroupBox("Audio")
        file_layout = QGridLayout(file_group)
        file_layout.setColumnStretch(1, 1)

        self.audio_path = QLineEdit()
        self.audio_path.setPlaceholderText(r"C:\...\enregistrement.m4a")
        self.audio_path.textChanged.connect(self._refresh_state)

        browse_btn = QPushButton("Choisir...")
        browse_btn.clicked.connect(self.choose_file)
        latest_btn = QPushButton("Dernier dans input")
        latest_btn.clicked.connect(self.use_latest_input)

        file_layout.addWidget(QLabel("Audio"), 0, 0)
        file_layout.addWidget(self.audio_path, 0, 1)
        file_layout.addWidget(browse_btn, 0, 2)
        file_layout.addWidget(latest_btn, 0, 3)
        file_hint = QLabel("Astuce: tu peux aussi glisser-deposer un fichier audio dans la fenetre.")
        file_hint.setObjectName("Muted")
        file_layout.addWidget(file_hint, 1, 1, 1, 3)
        audio_layout.addWidget(file_group)
        audio_layout.addStretch(1)

        audio_actions = QHBoxLayout()
        audio_actions.addStretch(1)
        self.next_audio_btn = QPushButton("Suivant")
        self.next_audio_btn.setObjectName("Primary")
        self.next_audio_btn.clicked.connect(lambda: self.tabs.setCurrentIndex(1))
        audio_actions.addWidget(self.next_audio_btn)
        audio_layout.addLayout(audio_actions)
        self.tabs.addTab(audio_screen, "Audio")

        transcription_screen = QWidget()
        transcription_layout = QVBoxLayout(transcription_screen)
        transcription_layout.setContentsMargins(18, 18, 18, 18)
        transcription_layout.setSpacing(16)

        transcription_title = QLabel("2. Regler la transcription")
        transcription_title.setObjectName("ScreenTitle")
        transcription_layout.addWidget(transcription_title)

        self.settings_hint = QLabel("")
        self.settings_hint.setObjectName("Warning")
        transcription_layout.addWidget(self.settings_hint)

        transcription_group = QGroupBox("Options")
        transcription_form_layout = QVBoxLayout(transcription_group)
        simple_form = QFormLayout()
        self.preset = QComboBox()
        self.preset.addItems(PRESET_LABELS)
        self.preset.currentIndexChanged.connect(self._apply_preset)
        simple_form.addRow("Profil", self.preset)

        self.preset_description = QLabel("")
        self.preset_description.setObjectName("Muted")
        self.preset_description.setWordWrap(True)
        simple_form.addRow("", self.preset_description)

        self.diarization = QCheckBox("Separer les personnes")
        self.diarization.setChecked(True)
        self.diarization.stateChanged.connect(self._refresh_state)
        simple_form.addRow("", self.diarization)

        self.speaker_mode = QComboBox()
        self.speaker_mode.addItems(["Auto", "Nombre exact", "Fourchette"])
        self.speaker_mode.currentIndexChanged.connect(self._refresh_state)
        self.speaker_mode_label = QLabel("Locuteurs")
        simple_form.addRow(self.speaker_mode_label, self.speaker_mode)
        self.speakers = QSpinBox()
        self.speakers.setRange(1, 20)
        self.speakers.setValue(3)
        self.speakers_label = QLabel("Exact")
        simple_form.addRow(self.speakers_label, self.speakers)
        self.min_speakers = QSpinBox()
        self.min_speakers.setRange(1, 20)
        self.min_speakers.setValue(2)
        self.min_speakers_label = QLabel("Minimum")
        simple_form.addRow(self.min_speakers_label, self.min_speakers)
        self.max_speakers = QSpinBox()
        self.max_speakers.setRange(1, 20)
        self.max_speakers.setValue(5)
        self.max_speakers_label = QLabel("Maximum")
        simple_form.addRow(self.max_speakers_label, self.max_speakers)
        transcription_form_layout.addLayout(simple_form)

        self.advanced_toggle = QCheckBox("Afficher les reglages avances")
        self.advanced_toggle.stateChanged.connect(self._toggle_advanced)
        transcription_form_layout.addWidget(self.advanced_toggle)

        self.advanced_group = QGroupBox("Reglages avances")
        quality_form = QFormLayout(self.advanced_group)
        self.model = QComboBox()
        self.model.addItems(["large-v3", "medium", "small", "large-v3-turbo"])
        self.model.setCurrentText("large-v3")
        self.asr_backend = QComboBox()
        self.asr_backend.addItems(["auto", "whisperx", "mlx"])
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
        self.compute_type.addItems(["auto", "int8", "float32", "float16"])
        for widget in (self.model, self.asr_backend, self.batch_size, self.threads, self.device, self.compute_type):
            if hasattr(widget, "currentIndexChanged"):
                widget.currentIndexChanged.connect(self._refresh_state)
            elif hasattr(widget, "valueChanged"):
                widget.valueChanged.connect(self._refresh_state)
        quality_form.addRow("Modele", self.model)
        quality_form.addRow("Backend", self.asr_backend)
        quality_form.addRow("Batch", self.batch_size)
        quality_form.addRow("Threads CPU", self.threads)
        quality_form.addRow("Device", self.device)
        quality_form.addRow("Calcul", self.compute_type)
        self.advanced_group.setVisible(False)
        transcription_form_layout.addWidget(self.advanced_group)
        transcription_layout.addWidget(transcription_group)
        transcription_layout.addStretch(1)

        transcription_actions = QHBoxLayout()
        back_to_audio = QPushButton("Retour")
        back_to_audio.clicked.connect(lambda: self.tabs.setCurrentIndex(0))
        self.settings_shortcut_btn = QPushButton("Settings")
        self.settings_shortcut_btn.clicked.connect(lambda: self.tabs.setCurrentIndex(4))
        self.next_transcription_btn = QPushButton("Suivant")
        self.next_transcription_btn.setObjectName("Primary")
        self.next_transcription_btn.clicked.connect(lambda: self.tabs.setCurrentIndex(2))
        transcription_actions.addWidget(back_to_audio)
        transcription_actions.addStretch(1)
        transcription_actions.addWidget(self.settings_shortcut_btn)
        transcription_actions.addWidget(self.next_transcription_btn)
        transcription_layout.addLayout(transcription_actions)
        self.tabs.addTab(transcription_screen, "Transcription")

        execution_screen = QWidget()
        execution_layout = QVBoxLayout(execution_screen)
        execution_layout.setContentsMargins(18, 18, 18, 18)
        execution_layout.setSpacing(14)

        execution_title = QLabel("3. Lancer et suivre")
        execution_title.setObjectName("ScreenTitle")
        execution_layout.addWidget(execution_title)

        self.execution_hint = QLabel("")
        self.execution_hint.setObjectName("Warning")
        execution_layout.addWidget(self.execution_hint)

        actions = QHBoxLayout()
        self.start_btn = QPushButton("Lancer")
        self.start_btn.setObjectName("Primary")
        self.start_btn.clicked.connect(self.start_transcription)
        self.stop_btn = QPushButton("Arreter")
        self.stop_btn.clicked.connect(self.stop_transcription)
        self.stop_btn.setEnabled(False)
        self.command_toggle = QPushButton("Afficher la commande")
        self.command_toggle.clicked.connect(self._toggle_command_preview)
        self.command_preview = QLineEdit()
        self.command_preview.setReadOnly(True)
        self.command_preview.setVisible(False)
        actions.addWidget(self.start_btn)
        actions.addWidget(self.stop_btn)
        actions.addWidget(self.command_toggle)
        actions.addStretch(1)
        execution_layout.addLayout(actions)
        execution_layout.addWidget(self.command_preview)

        progress_group = QGroupBox("Execution")
        progress_layout = QGridLayout(progress_group)
        progress_layout.setColumnStretch(1, 1)
        self.stage_label = QLabel("Pret.")
        self.stage_label.setObjectName("Stage")
        self.elapsed_label = QLabel("00:00")
        self.elapsed_label.setObjectName("Muted")
        self.progress = QProgressBar()
        self.progress.setRange(0, 1)
        self.progress.setValue(0)
        progress_layout.addWidget(QLabel("Etat"), 0, 0)
        progress_layout.addWidget(self.stage_label, 0, 1)
        progress_layout.addWidget(self.elapsed_label, 0, 2)
        progress_layout.addWidget(self.progress, 1, 0, 1, 3)
        execution_layout.addWidget(progress_group)

        self.log = QTextEdit()
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
        go_to_results = QPushButton("Resultats")
        go_to_results.clicked.connect(lambda: self.tabs.setCurrentIndex(3))
        execution_nav.addWidget(back_to_transcription)
        execution_nav.addStretch(1)
        execution_nav.addWidget(go_to_results)
        execution_layout.addLayout(execution_nav)
        self.tabs.addTab(execution_screen, "Execution")

        results_screen = QWidget()
        results_screen_layout = QVBoxLayout(results_screen)
        results_screen_layout.setContentsMargins(18, 18, 18, 18)
        results_screen_layout.setSpacing(16)

        results_title = QLabel("4. Recuperer les resultats")
        results_title.setObjectName("ScreenTitle")
        results_screen_layout.addWidget(results_title)

        results_group = QGroupBox("Fichiers")
        self.results_layout = QVBoxLayout(results_group)
        self.results_empty = QLabel("Aucun resultat pour l'instant.")
        self.results_empty.setObjectName("Muted")
        self.results_layout.addWidget(self.results_empty)
        results_screen_layout.addWidget(results_group)
        results_screen_layout.addStretch(1)

        results_actions = QHBoxLayout()
        new_audio_btn = QPushButton("Nouvelle transcription")
        new_audio_btn.clicked.connect(lambda: self.tabs.setCurrentIndex(0))
        open_output_btn = QPushButton("Ouvrir output")
        open_output_btn.clicked.connect(self.open_output)
        results_actions.addWidget(new_audio_btn)
        results_actions.addStretch(1)
        results_actions.addWidget(open_output_btn)
        results_screen_layout.addLayout(results_actions)
        self.tabs.addTab(results_screen, "Resultats")

        settings_screen = QWidget()
        settings_layout = QVBoxLayout(settings_screen)
        settings_layout.setContentsMargins(18, 18, 18, 18)
        settings_layout.setSpacing(16)

        settings_title = QLabel("Settings")
        settings_title.setObjectName("ScreenTitle")
        settings_layout.addWidget(settings_title)

        token_group = QGroupBox("Hugging Face")
        token_form = QFormLayout(token_group)
        self.hf_token = QLineEdit()
        self.hf_token.setEchoMode(QLineEdit.Password)
        self.hf_token.setPlaceholderText("hf_...")
        self.hf_token.textChanged.connect(self._refresh_state)
        self.save_token = QCheckBox("Enregistrer dans .env")
        self.show_token = QCheckBox("Afficher")
        self.show_token.stateChanged.connect(self.toggle_token_visibility)
        token_form.addRow("Token HF", self.hf_token)
        token_form.addRow("", self.save_token)
        token_form.addRow("", self.show_token)
        token_hint = QLabel("Necessaire uniquement si la separation des personnes est activee.")
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
        self.tabs.addTab(settings_screen, "Settings")

        self.setCentralWidget(central)
        self.setStatusBar(QStatusBar())

        open_input = QAction("Ouvrir input", self)
        open_input.triggered.connect(lambda: self.open_folder(INPUT_DIR))
        self.menuBar().addAction(open_input)

        self.setStyleSheet(
            """
            QMainWindow { background: #f6f7f9; }
            QLabel#Muted { color: #687386; }
            QLabel#Stage { font-weight: 600; color: #2f3747; }
            QLabel#ScreenTitle {
                color: #1f2937;
                font-size: 20px;
                font-weight: 700;
            }
            QLabel#Warning {
                color: #9a3412;
                font-weight: 600;
            }
            QTabWidget::pane {
                border: 1px solid #d9dde5;
                border-radius: 6px;
                background: #ffffff;
                top: -1px;
            }
            QTabBar::tab {
                border: 1px solid #cfd5df;
                border-bottom: none;
                padding: 9px 16px;
                background: #eef1f5;
                color: #2f3747;
            }
            QTabBar::tab:selected {
                background: #ffffff;
                color: #235fb4;
                font-weight: 700;
            }
            QGroupBox {
                border: 1px solid #d9dde5;
                border-radius: 6px;
                margin-top: 12px;
                padding: 12px;
                background: #ffffff;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 4px;
                color: #2f3747;
                font-weight: 600;
            }
            QLineEdit, QComboBox, QSpinBox, QTextEdit {
                border: 1px solid #cfd5df;
                border-radius: 5px;
                padding: 6px;
                background: #ffffff;
            }
            QPushButton {
                border: 1px solid #b8c0cc;
                border-radius: 5px;
                padding: 7px 12px;
                background: #ffffff;
            }
            QPushButton:hover { background: #eef3f8; }
            QPushButton:disabled { color: #8b94a3; background: #eceff3; }
            QPushButton#Primary {
                background: #235fb4;
                color: white;
                border-color: #235fb4;
                font-weight: 600;
            }
            QPushButton#Primary:hover { background: #1d529d; }
            QProgressBar {
                border: 1px solid #cfd5df;
                border-radius: 5px;
                height: 10px;
                background: #ffffff;
                text-align: center;
            }
            QProgressBar::chunk {
                border-radius: 4px;
                background: #235fb4;
            }
            """
        )

    def _load_settings(self) -> None:
        env_values = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
        token = env_values.get("HUGGINGFACE_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN", "")
        self.hf_token.setText(token)
        self.audio_path.setText(str(self.settings.value("audio_path", "")))
        preset = self._normalize_preset(str(self.settings.value("preset", PRESET_QUALITY)))
        self.preset.setCurrentText(preset)
        self.model.setCurrentText(str(self.settings.value("model", "large-v3")))
        self.asr_backend.setCurrentText(str(self.settings.value("asr_backend", "auto")))
        self.batch_size.setValue(int(self.settings.value("batch_size", 8)))
        self.threads.setValue(int(self.settings.value("threads", 0)))
        self.speaker_mode.setCurrentText(str(self.settings.value("speaker_mode", "Auto")))
        self.speakers.setValue(int(self.settings.value("speakers", 3)))
        self.min_speakers.setValue(int(self.settings.value("min_speakers", 2)))
        self.max_speakers.setValue(int(self.settings.value("max_speakers", 5)))
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
        self.settings.setValue("asr_backend", self.asr_backend.currentText())
        self.settings.setValue("batch_size", self.batch_size.value())
        self.settings.setValue("threads", self.threads.value())
        self.settings.setValue("speaker_mode", self.speaker_mode.currentText())
        self.settings.setValue("speakers", self.speakers.value())
        self.settings.setValue("min_speakers", self.min_speakers.value())
        self.settings.setValue("max_speakers", self.max_speakers.value())
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
        else:
            self.model.setCurrentText("large-v3")
            self.batch_size.setValue(8)
            self.device.setCurrentText("auto")
            self.compute_type.setCurrentText("auto")
            self.diarization.setChecked(True)
        self._refresh_state()

    def _update_preset_description(self) -> None:
        self.preset_description.setText(PRESET_DESCRIPTIONS.get(self.preset.currentText(), ""))

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
        self.preset.setEnabled(not is_running)
        self.advanced_toggle.setEnabled(not is_running)
        self.command_toggle.setEnabled(has_audio)

        self.command_preview.setText(" ".join(self._build_args(mask_token=True)) if has_audio else "")
        if needs_token and not has_token:
            self.settings_hint.setText("Token HF manquant: va dans l'onglet Settings pour activer la separation des personnes.")
            self.execution_hint.setText("Impossible de lancer avec separation des personnes sans token HF. Configure Settings ou desactive la separation.")
        else:
            self.settings_hint.setText("")
            self.execution_hint.setText("")

        if is_running:
            self.statusBar().showMessage("Transcription en cours...")
        elif not has_audio:
            self.statusBar().showMessage("Selectionne un fichier audio.")
        elif needs_token and not has_token:
            self.statusBar().showMessage("Token Hugging Face requis dans Settings pour separer les locuteurs.")
        else:
            self.statusBar().showMessage("Pret.")

    def choose_file(self) -> None:
        start_dir = str(Path(self.audio_path.text()).parent) if self.audio_path.text().strip() else str(INPUT_DIR)
        filename, _ = QFileDialog.getOpenFileName(self, "Choisir un fichier audio", start_dir, AUDIO_FILTER)
        if filename:
            self.audio_path.setText(filename)

    def use_latest_input(self) -> None:
        candidates: list[Path] = []
        for pattern in ("*.m4a", "*.mp3", "*.wav", "*.mp4", "*.webm", "*.flac", "*.ogg"):
            candidates.extend(INPUT_DIR.rglob(pattern))
        if not candidates:
            QMessageBox.warning(self, "Aucun fichier", f"Aucun fichier audio trouve dans {INPUT_DIR}.")
            return
        latest = max(candidates, key=lambda path: path.stat().st_mtime)
        self.audio_path.setText(str(latest))

    def toggle_token_visibility(self) -> None:
        self.hf_token.setEchoMode(QLineEdit.Normal if self.show_token.isChecked() else QLineEdit.Password)

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
            "fr",
            "--batch-size",
            str(self.batch_size.value()),
            "--threads",
            str(self.threads.value()),
            "--device",
            self.device.currentText(),
            "--compute-type",
            self.compute_type.currentText(),
        ]
        if self.diarization.isChecked():
            token = "hf_***" if mask_token else self.hf_token.text().strip()
            args.extend(["--hf-token", token])
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
            QMessageBox.critical(self, "Locuteurs", "Le minimum doit etre inferieur ou egal au maximum.")
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
        if not PYTHON.exists():
            QMessageBox.critical(self, "Environnement", "L'environnement .venv est introuvable. Lance .\\setup.ps1.")
            return

        self._save_settings()
        self.log.clear()
        self._clear_results()
        self._set_running_ui(True, "Preparation...")
        self.tabs.setCurrentIndex(2)
        self.append_log("Commande:\n" + " ".join(self._build_args(mask_token=True)) + "\n")

        self.process = QProcess(self)
        self.process.setProgram(str(PYTHON))
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
            self.append_log("\nArret demande...\n")
            self.process.kill()

    def read_stdout(self) -> None:
        if self.process:
            self.append_log(bytes(self.process.readAllStandardOutput()).decode("utf-8", errors="replace"))

    def read_stderr(self) -> None:
        if self.process:
            self.append_log(bytes(self.process.readAllStandardError()).decode("utf-8", errors="replace"))

    def process_finished(self, exit_code: int, _exit_status: QProcess.ExitStatus) -> None:
        self.append_log(f"\nProcess termine avec code {exit_code}.\n")
        self.process = None
        self._set_running_ui(False, "Termine." if exit_code == 0 else "Echec.", complete=exit_code == 0)
        self._refresh_state()
        if exit_code == 0:
            self.statusBar().showMessage("Termine. Les fichiers sont dans output.")
            self._show_results()
            self.tabs.setCurrentIndex(3)
        else:
            self.statusBar().showMessage("Echec. Regarde le journal.")

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
            self.progress.setRange(0, 0)
            self.elapsed_timer.start(1000)
        else:
            self.progress.setRange(0, 1)
            self.progress.setValue(1 if complete else 0)
            self.elapsed_timer.stop()

    def _tick_elapsed(self) -> None:
        self.elapsed_seconds += 1
        minutes, seconds = divmod(self.elapsed_seconds, 60)
        self.elapsed_label.setText(f"{minutes:02d}:{seconds:02d}")

    def _update_stage_from_log(self, text: str) -> None:
        stages = (
            ("Preparing clean", "Preparation audio..."),
            ("Using existing preprocessed WAV", "Audio prepare deja disponible."),
            ("Loading ASR model", "Chargement du modele..."),
            ("Transcribing", "Transcription..."),
            ("Aligning timestamps", "Alignement temporel..."),
            ("Running speaker diarization", "Separation des locuteurs..."),
            ("Diarization skipped", "Separation ignoree."),
            ("Done. Files written", "Ecriture des resultats..."),
        )
        for needle, label in stages:
            if needle in text:
                self.stage_label.setText(label)

    def _expected_outputs(self) -> list[Path]:
        audio_text = self.audio_path.text().strip()
        if not audio_text:
            return []
        stem = slugify(Path(audio_text).stem)
        return [
            OUTPUT_DIR / f"{stem}.speaker-turns.txt",
            OUTPUT_DIR / f"{stem}.speaker-turns.md",
            OUTPUT_DIR / f"{stem}.speaker-segments.srt",
            OUTPUT_DIR / f"{stem}.segments.json",
            OUTPUT_DIR / f"{stem}.whisperx.json",
        ]

    def _clear_results(self) -> None:
        while self.results_layout.count():
            item = self.results_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        self.results_empty = QLabel("Aucun resultat pour l'instant.")
        self.results_empty.setObjectName("Muted")
        self.results_layout.addWidget(self.results_empty)

    def _show_results(self) -> None:
        self._clear_results()
        paths = [path for path in self._expected_outputs() if path.exists()]
        if not paths:
            self.results_empty.setText("Termine, mais aucun fichier attendu n'a ete trouve dans output.")
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
            copy_btn = QPushButton("Copier chemin")
            copy_btn.clicked.connect(lambda _checked=False, p=path: QApplication.clipboard().setText(str(p)))
            row_layout.addWidget(open_btn)
            row_layout.addWidget(copy_btn)
            self.results_layout.addWidget(row)

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
                if Path(url.toLocalFile()).suffix.lower() in {".m4a", ".mp3", ".wav", ".mp4", ".webm", ".flac", ".ogg"}:
                    event.acceptProposedAction()
                    return
        event.ignore()

    def dropEvent(self, event) -> None:  # type: ignore[override]
        for url in event.mimeData().urls():
            path = Path(url.toLocalFile())
            if path.suffix.lower() in {".m4a", ".mp3", ".wav", ".mp4", ".webm", ".flac", ".ogg"}:
                self.audio_path.setText(str(path))
                event.acceptProposedAction()
                return

    def closeEvent(self, event) -> None:  # type: ignore[override]
        if self.process is not None:
            answer = QMessageBox.question(
                self,
                "Transcription en cours",
                "Arreter la transcription et fermer ?",
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
    app.setApplicationName("WhisperX Transcription")
    app.setWindowIcon(QIcon())
    window = TranscriptionWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
