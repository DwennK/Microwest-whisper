param(
    [string]$HfToken = $env:HUGGINGFACE_TOKEN,
    [int]$Speakers = 0,
    [int]$MinSpeakers = 0,
    [int]$MaxSpeakers = 0,
    [string]$Model = "large-v3",
    [ValidateSet("auto", "whisperx", "mlx")]
    [string]$AsrBackend = "auto",
    [ValidateSet("auto", "cpu", "cuda")]
    [string]$Device = "auto",
    [ValidateSet("auto", "int8", "int8_float16", "float32", "float16")]
    [string]$ComputeType = "auto",
    [int]$Threads = 0,
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
    Model = $Model
    AsrBackend = $AsrBackend
    Device = $Device
    ComputeType = $ComputeType
    Threads = $Threads
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

.\transcribe.ps1 @params
