param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Find-Python311 {
    $candidate = Get-Command py -ErrorAction SilentlyContinue
    if ($candidate) {
        try {
            py -3.11 --version | Out-Null
            return "py -3.11"
        } catch {}
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) {
        $version = & python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
        if ($version -eq "3.11") {
            return "python"
        }
    }

    throw "Python 3.11 is required. Install it with: winget install --id Python.Python.3.11 -e"
}

function Find-FFmpeg {
    $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (-not $ffmpeg) {
        $wingetFfmpeg = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName
        if ($wingetFfmpeg) {
            $bin = Split-Path $wingetFfmpeg -Parent
            $env:PATH = "$bin;$env:PATH"
            return $wingetFfmpeg
        }
        throw "FFmpeg is required. Install it with: winget install --id Gyan.FFmpeg -e"
    }
    return $ffmpeg.Source
}

$ffmpegPath = Find-FFmpeg
$pythonCmd = Find-Python311
Write-Host "FFmpeg: $ffmpegPath"

if ($Force -and (Test-Path ".venv")) {
    Remove-Item -Recurse -Force ".venv"
}

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment with $pythonCmd"
    Invoke-Expression "$pythonCmd -m venv .venv"
}

.\.venv\Scripts\python.exe -m pip install --upgrade pip setuptools wheel
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

Write-Host ""
Write-Host "Ready."
Write-Host "Put your audio file in the input folder, then run:"
Write-Host '.\transcribe.ps1 -Audio ".\input\recording.m4a" -HfToken "hf_xxx"'
