#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path


WHISPER_VERSION = "v1.9.1"
IMAGEIO_FFMPEG_VERSION = "0.6.0"
REPO_ROOT = Path(__file__).resolve().parents[1]
BIN_ROOT = REPO_ROOT / "engine" / "whispercpp" / "bin"


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch native whisper.cpp backend binaries.")
    parser.add_argument("--platform", default=os.environ.get("MICROWEST_BUNDLE_PLATFORM"))
    args = parser.parse_args()

    target = args.platform or detect_platform()
    if target not in {
        "macos-aarch64",
        "macos-x86_64",
        "windows-x86_64",
        "linux-x86_64",
        "linux-aarch64",
    }:
        raise SystemExit(f"Unsupported platform: {target}")

    with tempfile.TemporaryDirectory(prefix="microwest-whispercpp-") as tmp:
        tmp_dir = Path(tmp)
        target_dir = BIN_ROOT / target
        target_dir.mkdir(parents=True, exist_ok=True)
        fetch_whisper_cli(target, target_dir, tmp_dir)
        fetch_ffmpeg(target, target_dir, tmp_dir)

    print(f"Fetched whisper.cpp binaries for {target}: {target_dir}")


def detect_platform() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "darwin":
        return "macos-aarch64" if machine in {"arm64", "aarch64"} else "macos-x86_64"
    if system == "windows":
        return "windows-x86_64"
    if system == "linux":
        return "linux-aarch64" if machine in {"arm64", "aarch64"} else "linux-x86_64"
    raise SystemExit(f"Unsupported host platform: {system}-{machine}")


def fetch_whisper_cli(target: str, target_dir: Path, tmp_dir: Path) -> None:
    if target.startswith("macos-"):
        build_macos_whisper_cli(target_dir, tmp_dir)
        return
    if target == "windows-x86_64":
        fetch_windows_whisper_cli(target_dir, tmp_dir)
        return
    if target in {"linux-x86_64", "linux-aarch64"}:
        fetch_linux_whisper_cli(target, target_dir, tmp_dir)
        return
    raise SystemExit(f"No whisper-cli fetcher for {target}")


def build_macos_whisper_cli(target_dir: Path, tmp_dir: Path) -> None:
    archive = tmp_dir / "whisper.cpp.tar.gz"
    source_dir = tmp_dir / f"whisper.cpp-{WHISPER_VERSION.removeprefix('v')}"
    build_dir = source_dir / "build"
    download(
        f"https://github.com/ggml-org/whisper.cpp/archive/refs/tags/{WHISPER_VERSION}.tar.gz",
        archive,
    )
    with tarfile.open(archive, "r:gz") as tar:
        safe_extract_tar(tar, tmp_dir)

    cmake = cmake_command(tmp_dir)
    cmake_env = cmake_environment(tmp_dir)
    run(
        [
            *cmake,
            "-S",
            str(source_dir),
            "-B",
            str(build_dir),
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_SHARED_LIBS=OFF",
            "-DWHISPER_BUILD_TESTS=OFF",
            "-DWHISPER_BUILD_EXAMPLES=ON",
            "-DWHISPER_BUILD_SERVER=OFF",
            "-DGGML_METAL=ON",
            "-DGGML_METAL_EMBED_LIBRARY=ON",
        ],
        env=cmake_env,
    )
    run([*cmake, "--build", str(build_dir), "--config", "Release", "--target", "whisper-cli"], env=cmake_env)
    install_executable(build_dir / "bin" / "whisper-cli", target_dir / "whisper-cli")


def fetch_windows_whisper_cli(target_dir: Path, tmp_dir: Path) -> None:
    archive = tmp_dir / "whisper-bin-x64.zip"
    extract_dir = tmp_dir / "whisper-bin-x64"
    download(
        f"https://github.com/ggml-org/whisper.cpp/releases/download/{WHISPER_VERSION}/whisper-bin-x64.zip",
        archive,
    )
    with zipfile.ZipFile(archive) as zipped:
        zipped.extractall(extract_dir)
    release_dir = extract_dir / "Release"
    install_executable(release_dir / "whisper-cli.exe", target_dir / "whisper-cli.exe")
    for dll in release_dir.glob("*.dll"):
        shutil.copy2(dll, target_dir / dll.name)


def fetch_linux_whisper_cli(target: str, target_dir: Path, tmp_dir: Path) -> None:
    arch = "arm64" if target == "linux-aarch64" else "x64"
    archive = tmp_dir / f"whisper-bin-ubuntu-{arch}.tar.gz"
    extract_dir = tmp_dir / f"whisper-bin-ubuntu-{arch}"
    download(
        f"https://github.com/ggml-org/whisper.cpp/releases/download/{WHISPER_VERSION}/whisper-bin-ubuntu-{arch}.tar.gz",
        archive,
    )
    with tarfile.open(archive, "r:gz") as tar:
        safe_extract_tar(tar, tmp_dir)
    install_executable(extract_dir / "whisper-cli", target_dir / "whisper-cli")
    for library in extract_dir.glob("*.so*"):
        shutil.copy2(library, target_dir / library.name)


def fetch_ffmpeg(target: str, target_dir: Path, tmp_dir: Path) -> None:
    wheel = tmp_dir / "imageio-ffmpeg.whl"
    extract_dir = tmp_dir / "imageio-ffmpeg"
    download(imageio_ffmpeg_wheel_url(target), wheel)
    with zipfile.ZipFile(wheel) as zipped:
        zipped.extractall(extract_dir)
    binary = next((path for path in extract_dir.rglob("ffmpeg*") if path.is_file()), None)
    if binary is None:
        raise SystemExit("Could not find FFmpeg binary in imageio-ffmpeg wheel")
    name = "ffmpeg.exe" if target.startswith("windows-") else "ffmpeg"
    install_executable(binary, target_dir / name)


def imageio_ffmpeg_wheel_url(target: str) -> str:
    tags = {
        "macos-aarch64": "macosx_11_0_arm64",
        "macos-x86_64": "macosx_10_9_x86_64",
        "windows-x86_64": "win_amd64",
        "linux-x86_64": "manylinux2014_x86_64",
        "linux-aarch64": "manylinux2014_aarch64",
    }
    tag = tags[target]
    with urllib.request.urlopen(f"https://pypi.org/pypi/imageio-ffmpeg/{IMAGEIO_FFMPEG_VERSION}/json") as response:
        payload = json.load(response)
    for file_info in payload["urls"]:
        filename = file_info["filename"]
        if filename.endswith(".whl") and tag in filename:
            return file_info["url"]
    raise SystemExit(f"Could not find imageio-ffmpeg wheel for {target}")


def cmake_command(tmp_dir: Path) -> list[str]:
    if shutil.which("cmake"):
        return ["cmake"]
    target = tmp_dir / "cmake-python"
    run([sys.executable, "-m", "pip", "install", "--target", str(target), "cmake"])
    return [sys.executable, "-m", "cmake"]


def cmake_environment(tmp_dir: Path) -> dict[str, str]:
    target = tmp_dir / "cmake-python"
    env = os.environ.copy()
    if target.exists():
        existing = env.get("PYTHONPATH")
        env["PYTHONPATH"] = str(target) if not existing else f"{target}{os.pathsep}{existing}"
    return env


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}")
    with urllib.request.urlopen(url) as response, destination.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def install_executable(source: Path, destination: Path) -> None:
    if not source.exists():
        raise SystemExit(f"Missing expected binary: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    destination.chmod(destination.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def safe_extract_tar(tar: tarfile.TarFile, destination: Path) -> None:
    root = destination.resolve()
    for member in tar.getmembers():
        target = (destination / member.name).resolve()
        if root != target and root not in target.parents:
            raise SystemExit(f"Unsafe tar member path: {member.name}")
    tar.extractall(destination)


def run(command: list[str], env=None) -> None:
    print("+", " ".join(command))
    subprocess.run(command, check=True, env=env)


if __name__ == "__main__":
    main()
