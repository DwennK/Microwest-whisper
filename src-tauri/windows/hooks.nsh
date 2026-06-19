!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$LOCALAPPDATA\Microwest Whisper\models"
  RMDir "$LOCALAPPDATA\Microwest Whisper"
  RMDir /r "$APPDATA\Microwest Whisper\models"
  RMDir "$APPDATA\Microwest Whisper"
!macroend
