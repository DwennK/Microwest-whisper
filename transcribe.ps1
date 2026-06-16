param(
    [Parameter(Mandatory = $true)]
    [string]$Audio,

    [string]$HfToken = $env:HUGGINGFACE_TOKEN,
    [int]$Speakers = 0,
    [int]$MinSpeakers = 0,
    [int]$MaxSpeakers = 0,
    [ValidateSet("manual", "auto", "quality", "fast", "cpu", "no-speakers")]
    [string]$Profile = "manual",
    [string]$Model = "large-v3",
    [string]$Language = "fr",
    [ValidateSet("auto", "whisperx", "mlx")]
    [string]$AsrBackend = "auto",
    [ValidateSet("auto", "cpu", "cuda")]
    [string]$Device = "auto",
    [ValidateSet("auto", "int8", "int8_float16", "float32", "float16")]
    [string]$ComputeType = "auto",
    [int]$Threads = 0,
    [ValidateSet("loudnorm", "voice-clean", "none")]
    [string]$AudioFilter = "loudnorm",
    [string]$SpeakerMap = "",
    [switch]$TrimSilence,
    [switch]$Force,
    [switch]$NoDiarization
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    throw "Virtual environment missing. Run .\setup.ps1 first."
}

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpeg) {
    $wingetFfmpeg = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if ($wingetFfmpeg) {
        $env:PATH = "$(Split-Path $wingetFfmpeg -Parent);$env:PATH"
    }
}

$argsList = @(
    "transcribe.py",
    "--audio", $Audio,
    "--profile", $Profile,
    "--model", $Model,
    "--asr-backend", $AsrBackend,
    "--device", $Device,
    "--compute-type", $ComputeType,
    "--threads", "$Threads",
    "--language", $Language,
    "--audio-filter", $AudioFilter
)

if ($NoDiarization) {
    $argsList += "--no-diarization"
} else {
    if ($HfToken) {
        $argsList += @("--hf-token", $HfToken)
    }
}

if ($Speakers -gt 0) {
    $argsList += @("--speakers", "$Speakers")
}
if ($MinSpeakers -gt 0) {
    $argsList += @("--min-speakers", "$MinSpeakers")
}
if ($MaxSpeakers -gt 0) {
    $argsList += @("--max-speakers", "$MaxSpeakers")
}
if ($SpeakerMap) {
    $argsList += @("--speaker-map", $SpeakerMap)
}
if ($TrimSilence) {
    $argsList += "--trim-silence"
}
if ($Force) {
    $argsList += "--force"
}

.\.venv\Scripts\python.exe @argsList
