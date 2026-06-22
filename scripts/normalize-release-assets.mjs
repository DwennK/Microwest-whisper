import { existsSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const artifactsDir = resolve(process.argv[2] ?? "release-artifacts");

if (!existsSync(artifactsDir)) {
  throw new Error(`Release artifacts directory not found: ${artifactsDir}`);
}

const rules = [
  { test: (name) => name.endsWith(".app.tar.gz"), output: "Microwest-Whisper-mac.app.tar.gz" },
  { test: (name) => name.endsWith(".dmg"), output: "Microwest-Whisper-mac.dmg" },
  { test: (name) => name.endsWith(".nsis.zip"), output: "Microwest-Whisper-windows.nsis.zip" },
  { test: (name) => name.endsWith(".msi.zip"), output: "Microwest-Whisper-windows.msi.zip" },
  { test: (name) => name.endsWith(".exe"), output: "Microwest-Whisper-windows.exe" },
  { test: (name) => name.endsWith(".msi"), output: "Microwest-Whisper-windows.msi" },
  { test: (name) => name.endsWith(".AppImage.tar.gz"), output: "Microwest-Whisper-linux.AppImage.tar.gz" },
  { test: (name) => name.endsWith(".AppImage"), output: "Microwest-Whisper-linux.AppImage" },
  { test: (name) => name.endsWith(".deb"), output: "Microwest-Whisper-linux.deb" },
  { test: (name) => name.endsWith(".rpm"), output: "Microwest-Whisper-linux.rpm" },
];

const renamed = [];

for (const path of walk(artifactsDir)) {
  if (path.endsWith(".sig")) continue;

  const name = basename(path);
  const rule = rules.find((candidate) => candidate.test(name));
  if (!rule || name === rule.output) continue;

  const targetPath = join(dirname(path), rule.output);
  move(path, targetPath);
  renamed.push(`${name} -> ${rule.output}`);

  const signaturePath = `${path}.sig`;
  if (existsSync(signaturePath)) {
    move(signaturePath, `${targetPath}.sig`);
    renamed.push(`${name}.sig -> ${rule.output}.sig`);
  }
}

if (renamed.length === 0) {
  console.log("Release artifact names already normalized.");
} else {
  console.log("Normalized release artifacts:");
  for (const entry of renamed) {
    console.log(`- ${entry}`);
  }
}

function move(source, target) {
  if (source === target) return;
  if (existsSync(target)) {
    throw new Error(`Cannot rename ${source}; target already exists: ${target}`);
  }
  renameSync(source, target);
}

function walk(root) {
  const entries = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...walk(path));
    } else if (stat.isFile() && extname(path) !== ".blockmap") {
      entries.push(path);
    }
  }
  return entries;
}
