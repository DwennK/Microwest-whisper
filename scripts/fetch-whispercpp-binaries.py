#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import stat
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BIN_ROOT = REPO_ROOT / "engine" / "whispercpp" / "bin"
MANIFEST_PATH = REPO_ROOT / "scripts" / "native-dependencies.json"


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch native whisper.cpp backend binaries.")
    parser.add_argument("--platform", default=os.environ.get("MICROWEST_BUNDLE_PLATFORM"))
    parser.add_argument("--verify-manifest", action="store_true")
    args = parser.parse_args()
    manifest = load_manifest()

    if args.verify_manifest:
        verify_manifest(manifest)
        print(f"Native dependency manifest verified: {MANIFEST_PATH}")
        return

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
        fetch_whisper_cli(manifest, target, target_dir, tmp_dir)
        fetch_ffmpeg(manifest, target, target_dir, tmp_dir)

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


def load_manifest() -> dict:
    with MANIFEST_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def verify_manifest(manifest: dict) -> None:
    if manifest.get("manifest_version") != 1:
        raise SystemExit("Unsupported native dependency manifest version")
    components = manifest.get("components", {})
    required_artifacts = {
        "whisper.cpp": {"source", "windows-x86_64", "linux-x86_64", "linux-aarch64"},
        "imageio-ffmpeg": {"macos-aarch64", "macos-x86_64", "windows-x86_64", "linux-x86_64", "linux-aarch64"},
    }
    for name, required in required_artifacts.items():
        component = components.get(name)
        if not isinstance(component, dict) or not component.get("version"):
            raise SystemExit(f"Missing component metadata: {name}")
        license_info = component.get("license", {})
        if not license_info.get("spdx") or not str(license_info.get("url", "")).startswith("https://"):
            raise SystemExit(f"Missing pinned license metadata: {name}")
        artifacts = component.get("artifacts", {})
        if not required.issubset(artifacts):
            raise SystemExit(f"Missing pinned artifacts for {name}: {sorted(required - set(artifacts))}")
        for artifact_name, artifact in artifacts.items():
            url = str(artifact.get("url", ""))
            checksum = str(artifact.get("sha256", ""))
            if not url.startswith("https://"):
                raise SystemExit(f"Insecure artifact URL for {name}/{artifact_name}")
            if len(checksum) != 64 or any(character not in "0123456789abcdef" for character in checksum):
                raise SystemExit(f"Invalid SHA-256 for {name}/{artifact_name}")


def component(manifest: dict, name: str) -> dict:
    return manifest["components"][name]


def artifact(manifest: dict, component_name: str, artifact_name: str) -> dict:
    return component(manifest, component_name)["artifacts"][artifact_name]


def fetch_whisper_cli(manifest: dict, target: str, target_dir: Path, tmp_dir: Path) -> None:
    if target.startswith("macos-"):
        build_macos_whisper_cli(manifest, target_dir, tmp_dir)
        return
    if target == "windows-x86_64":
        fetch_windows_whisper_cli(manifest, target_dir, tmp_dir)
        return
    if target in {"linux-x86_64", "linux-aarch64"}:
        fetch_linux_whisper_cli(manifest, target, target_dir, tmp_dir)
        return
    raise SystemExit(f"No whisper-cli fetcher for {target}")


def build_macos_whisper_cli(manifest: dict, target_dir: Path, tmp_dir: Path) -> None:
    whisper = component(manifest, "whisper.cpp")
    source = artifact(manifest, "whisper.cpp", "source")
    archive = tmp_dir / "whisper.cpp.tar.gz"
    source_dir = tmp_dir / f"whisper.cpp-{whisper['version'].removeprefix('v')}"
    build_dir = source_dir / "build"
    download(source["url"], archive, source["sha256"])
    with tarfile.open(archive, "r:gz") as tar:
        safe_extract_tar(tar, tmp_dir)

    cmake = cmake_command()
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
    )
    run([*cmake, "--build", str(build_dir), "--config", "Release", "--target", "whisper-cli"])
    install_executable(build_dir / "bin" / "whisper-cli", target_dir / "whisper-cli")


def fetch_windows_whisper_cli(manifest: dict, target_dir: Path, tmp_dir: Path) -> None:
    pinned = artifact(manifest, "whisper.cpp", "windows-x86_64")
    archive = tmp_dir / "whisper-bin-x64.zip"
    extract_dir = tmp_dir / "whisper-bin-x64"
    download(pinned["url"], archive, pinned["sha256"])
    with zipfile.ZipFile(archive) as zipped:
        zipped.extractall(extract_dir)
    release_dir = extract_dir / "Release"
    install_executable(release_dir / "whisper-cli.exe", target_dir / "whisper-cli.exe")
    for dll in release_dir.glob("*.dll"):
        shutil.copy2(dll, target_dir / dll.name)


def fetch_linux_whisper_cli(manifest: dict, target: str, target_dir: Path, tmp_dir: Path) -> None:
    arch = "arm64" if target == "linux-aarch64" else "x64"
    archive = tmp_dir / f"whisper-bin-ubuntu-{arch}.tar.gz"
    extract_dir = tmp_dir / f"whisper-bin-ubuntu-{arch}"
    pinned = artifact(manifest, "whisper.cpp", target)
    download(pinned["url"], archive, pinned["sha256"])
    with tarfile.open(archive, "r:gz") as tar:
        safe_extract_tar(tar, tmp_dir)
    install_executable(extract_dir / "whisper-cli", target_dir / "whisper-cli")
    for library in extract_dir.glob("*.so*"):
        shutil.copy2(library, target_dir / library.name)


def fetch_ffmpeg(manifest: dict, target: str, target_dir: Path, tmp_dir: Path) -> None:
    pinned = artifact(manifest, "imageio-ffmpeg", target)
    wheel = tmp_dir / "imageio-ffmpeg.whl"
    extract_dir = tmp_dir / "imageio-ffmpeg"
    download(pinned["url"], wheel, pinned["sha256"])
    with zipfile.ZipFile(wheel) as zipped:
        zipped.extractall(extract_dir)
    binary = next((path for path in extract_dir.rglob("ffmpeg*") if path.is_file()), None)
    if binary is None:
        raise SystemExit("Could not find FFmpeg binary in imageio-ffmpeg wheel")
    name = "ffmpeg.exe" if target.startswith("windows-") else "ffmpeg"
    installed = target_dir / name
    install_executable(binary, installed)
    verify_ffmpeg_license(manifest, installed)


def cmake_command() -> list[str]:
    if shutil.which("cmake"):
        return ["cmake"]
    raise SystemExit(
        "CMake is required to build the pinned macOS whisper.cpp source. "
        "Install it with Homebrew (`brew install cmake`) and retry."
    )


def download(url: str, destination: Path, expected_sha256: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}")
    digest = hashlib.sha256()
    with urllib.request.urlopen(url) as response, destination.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)
            digest.update(chunk)
    actual_sha256 = digest.hexdigest()
    if actual_sha256 != expected_sha256:
        destination.unlink(missing_ok=True)
        raise SystemExit(
            f"SHA-256 mismatch for {url}: received {actual_sha256}, expected {expected_sha256}"
        )
    print(f"Verified SHA-256 {actual_sha256}")


def verify_ffmpeg_license(manifest: dict, executable: Path) -> None:
    license_policy = component(manifest, "imageio-ffmpeg")["bundled_binary_license"]
    result = subprocess.run(
        [str(executable), "-version"],
        check=True,
        capture_output=True,
        text=True,
    )
    build_info = f"{result.stdout}\n{result.stderr}"
    required = license_policy["required_build_flag"]
    forbidden = license_policy["forbidden_build_flags"]
    if required not in build_info:
        raise SystemExit(f"FFmpeg license flag missing: {required}")
    present_forbidden = [flag for flag in forbidden if flag in build_info]
    if present_forbidden:
        raise SystemExit(f"Forbidden FFmpeg build flags: {', '.join(present_forbidden)}")
    (executable.parent / "FFMPEG_BUILD.txt").write_text(build_info.strip() + "\n", encoding="utf-8")
    print(f"Verified FFmpeg license policy: {license_policy['spdx']}")


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
