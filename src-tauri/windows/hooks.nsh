!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    RMDir /r "$LOCALAPPDATA\Microwest Whisper\models"
    RMDir "$LOCALAPPDATA\Microwest Whisper"
    RMDir /r "$APPDATA\Microwest Whisper\models"
    RMDir "$APPDATA\Microwest Whisper"
  ${EndIf}
!macroend
