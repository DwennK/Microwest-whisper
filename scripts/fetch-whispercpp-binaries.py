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
    if target != detect_platform():
        raise SystemExit(
            f"Build {target} on a matching host; source builds do not cross-compile "
            f"from {detect_platform()}."
        )

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
        "whisper.cpp": {"source"},
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

    ffmpeg_policy = components["imageio-ffmpeg"].get("bundled_binary_license", {})
    if not all(ffmpeg_policy.get(key) for key in ("spdx", "version3_spdx", "required_build_flag")):
        raise SystemExit("Incomplete FFmpeg bundled binary license policy")
    if "--enable-nonfree" not in ffmpeg_policy.get("forbidden_build_flags", []):
        raise SystemExit("FFmpeg license policy must reject --enable-nonfree")


def component(manifest: dict, name: str) -> dict:
    return manifest["components"][name]


def artifact(manifest: dict, component_name: str, artifact_name: str) -> dict:
    return component(manifest, component_name)["artifacts"][artifact_name]


def fetch_whisper_cli(manifest: dict, target: str, target_dir: Path, tmp_dir: Path) -> None:
    # Build the same verified release on every OS; upstream does not publish
    # prebuilt CLI assets for every release.
    whisper = component(manifest, "whisper.cpp")
    source = artifact(manifest, "whisper.cpp", "source")
    archive = tmp_dir / "whisper.cpp.tar.gz"
    source_dir = tmp_dir / f"whisper.cpp-{whisper['version'].removeprefix('v')}"
    build_dir = source_dir / "build"
    download(source["url"], archive, source["sha256"])
    with tarfile.open(archive, "r:gz") as tar:
        safe_extract_tar(tar, tmp_dir)

    cmake = cmake_command()
    options = [
        "-DCMAKE_BUILD_TYPE=Release",
        "-DBUILD_SHARED_LIBS=OFF",
        "-DWHISPER_BUILD_TESTS=OFF",
        "-DWHISPER_BUILD_EXAMPLES=ON",
        "-DWHISPER_BUILD_SERVER=OFF",
        "-DGGML_NATIVE=OFF",
        "-DGGML_OPENMP=OFF",
        f"-DGGML_METAL={'ON' if target.startswith('macos-') else 'OFF'}",
    ]
    if target.startswith("macos-"):
        options += [
            "-DGGML_METAL_EMBED_LIBRARY=ON",
            f"-DCMAKE_OSX_ARCHITECTURES={'arm64' if target == 'macos-aarch64' else 'x86_64'}",
        ]
    elif target == "windows-x86_64":
        options += ["-A", "x64"]
    run([*cmake, "-S", str(source_dir), "-B", str(build_dir), *options])
    run([
        *cmake, "--build", str(build_dir), "--config", "Release",
        "--target", "whisper-cli", "--parallel", str(min(os.cpu_count() or 2, 4)),
    ])
    filename = "whisper-cli.exe" if target.startswith("windows-") else "whisper-cli"
    binary_dir = build_dir / "bin"
    if target.startswith("windows-"):
        binary_dir /= "Release"
    install_executable(binary_dir / filename, target_dir / filename)


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
        "CMake and a C++ compiler are required to build the pinned whisper.cpp source. "
        "Install CMake (macOS: `brew install cmake`) and retry."
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
    effective_spdx = (
        license_policy["version3_spdx"]
        if "--enable-version3" in build_info
        else license_policy["spdx"]
    )
    recorded_build = f"Microwest verified SPDX: {effective_spdx}\n\n{build_info.strip()}\n"
    (executable.parent / "FFMPEG_BUILD.txt").write_text(recorded_build, encoding="utf-8")
    print(f"Verified FFmpeg license policy: {effective_spdx}")


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
