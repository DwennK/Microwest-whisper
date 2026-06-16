param(
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

$audio = Get-ChildItem -Path ".\input" -File -Include *.m4a,*.mp3,*.wav,*.mp4,*.webm,*.flac,*.ogg -Recurse |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $audio) {
    throw "No audio file found in .\input. Put your M4A there first."
}

Write-Host "Using latest audio file: $($audio.FullName)"

$params = @{
    Audio = $audio.FullName
    Profile = $Profile
    Model = $Model
    Language = $Language
    AsrBackend = $AsrBackend
    Device = $Device
    ComputeType = $ComputeType
    Threads = $Threads
    AudioFilter = $AudioFilter
}

if ($HfToken) {
    $params.HfToken = $HfToken
}
if ($Speakers -gt 0) {
    $params.Speakers = $Speakers
}
if ($MinSpeakers -gt 0) {
    $params.MinSpeakers = $MinSpeakers
}
if ($MaxSpeakers -gt 0) {
    $params.MaxSpeakers = $MaxSpeakers
}
if ($NoDiarization) {
    $params.NoDiarization = $true
}
if ($SpeakerMap) {
    $params.SpeakerMap = $SpeakerMap
}
if ($TrimSilence) {
    $params.TrimSilence = $true
}
if ($Force) {
    $params.Force = $true
}

.\transcribe.ps1 @params
