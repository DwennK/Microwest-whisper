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

const ffmpegName = platform.startsWith("windows-") ? "ffmpeg.exe" : "ffmpeg";

const sourceBinDir = join(sourceRoot, "bin", platform);
const targetBinDir = join(targetRoot, "bin", platform);
const targetModelsDir = join(targetRoot, "models");

const required = [
  join(sourceBinDir, "FFMPEG_BUILD.txt"),
  join(sourceBinDir, ffmpegName),
];

const missing = required.filter((path) => !existsSync(path));
if (missing.length > 0) {
  throw new Error(
    [
      `Missing FFmpeg resources for ${platform}:`,
      ...missing.map((path) => `- ${path}`),
      "Add them before running a release build, or set MICROWEST_BUNDLE_PLATFORM for another target.",
    ].join("\n"),
  );
}

rmSync(targetRoot, { force: true, recursive: true });
mkdirSync(targetBinDir, { recursive: true });
mkdirSync(targetModelsDir, { recursive: true });

copyOptional(join(sourceRoot, "README.md"), join(targetRoot, "README.md"));
copyOptional(join(sourceRoot, "THIRD_PARTY_NOTICES.md"), join(targetRoot, "THIRD_PARTY_NOTICES.md"));
copyOptional(join(repoRoot, "scripts", "native-dependencies.json"), join(targetRoot, "native-dependencies.json"));
copyOptional(join(sourceRoot, "models", ".gitkeep"), join(targetModelsDir, ".gitkeep"));
copyDirectoryFiles(join(sourceRoot, "licenses"), join(targetRoot, "licenses"));
for (const name of [ffmpegName, "FFMPEG_BUILD.txt"]) {
  copyFileSync(join(sourceBinDir, name), join(targetBinDir, name));
}

console.log(`Prepared native resources for ${platform}`);

function copyDirectoryFiles(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
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
