import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(repoRoot, "engine", "whispercpp");
const targetRoot = join(repoRoot, "src-tauri", "resources", "engine", "whispercpp");

const platformAliases = new Map([
  ["darwin-arm64", "macos-aarch64"],
  ["darwin-x64", "macos-x86_64"],
  ["win32-x64", "windows-x86_64"],
  ["linux-x64", "linux-x86_64"],
]);

const platform =
  process.env.MICROWEST_BUNDLE_PLATFORM ||
  platformAliases.get(`${process.platform}-${process.arch}`);

if (!platform) {
  throw new Error(
    `Unsupported build platform ${process.platform}-${process.arch}. Set MICROWEST_BUNDLE_PLATFORM.`,
  );
}

const executableNames =
  platform.startsWith("windows-")
    ? { whisper: "whisper-cli.exe", ffmpeg: "ffmpeg.exe" }
    : { whisper: "whisper-cli", ffmpeg: "ffmpeg" };

const sourceBinDir = join(sourceRoot, "bin", platform);
const targetBinDir = join(targetRoot, "bin", platform);
const targetModelsDir = join(targetRoot, "models");

const required = [
  join(sourceBinDir, executableNames.whisper),
  join(sourceBinDir, executableNames.ffmpeg),
];

const missing = required.filter((path) => !existsSync(path));
if (missing.length > 0) {
  throw new Error(
    [
      `Missing whisper.cpp bundled binaries for ${platform}:`,
      ...missing.map((path) => `- ${path}`),
      "Add them before running a release build, or set MICROWEST_BUNDLE_PLATFORM for another target.",
    ].join("\n"),
  );
}

rmSync(targetRoot, { force: true, recursive: true });
mkdirSync(targetBinDir, { recursive: true });
mkdirSync(targetModelsDir, { recursive: true });

copyOptional(join(sourceRoot, "README.md"), join(targetRoot, "README.md"));
copyOptional(join(sourceRoot, "models", ".gitkeep"), join(targetModelsDir, ".gitkeep"));
copyDirectoryFiles(sourceBinDir, targetBinDir);

console.log(`Prepared whisper.cpp resources for ${platform}`);

function copyDirectoryFiles(sourceDir, targetDir) {
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    const stat = statSync(sourcePath);
    if (stat.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      copyDirectoryFiles(sourcePath, targetPath);
      continue;
    }
    if (stat.isFile()) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyOptional(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) {
    return;
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}
