import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const artifactsDir = resolve(process.argv[2] ?? "release-artifacts");
const tagName = process.env.TAG_NAME ?? process.env.GITHUB_REF_NAME;
const repository = process.env.GITHUB_REPOSITORY ?? "DwennK/Microwest-whisper";

if (!tagName) {
  throw new Error("TAG_NAME or GITHUB_REF_NAME is required to generate latest.json");
}

if (!existsSync(artifactsDir)) {
  throw new Error(`Release artifacts directory not found: ${artifactsDir}`);
}

const version = tagName.replace(/^v/i, "");
const releaseBaseUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(tagName)}`;
const signatures = walk(artifactsDir).filter((path) => path.endsWith(".sig"));
const platforms = new Map();

for (const signaturePath of signatures) {
  const artifactPath = signaturePath.slice(0, -".sig".length);
  if (!existsSync(artifactPath)) {
    throw new Error(`Updater signature has no artifact: ${signaturePath}`);
  }

  const target = platformTarget(artifactPath);
  if (!target) {
    throw new Error(`Unsupported updater artifact: ${artifactPath}`);
  }
  if (!readFileSync(signaturePath, "utf8").trim()) {
    throw new Error(`Empty updater signature: ${signaturePath}`);
  }

  const candidate = {
    signaturePath,
    artifactPath,
  };
  const previous = platforms.get(target);
  if (previous) throw new Error(`Duplicate updater artifact for ${target}`);
  platforms.set(target, candidate);
}

for (const target of ["darwin-aarch64", "windows-x86_64"]) {
  if (!platforms.has(target)) {
    throw new Error(`Missing signed updater artifact for ${target}`);
  }
}

const manifest = {
  version,
  notes: `Microwest Whisper ${version}`,
  pub_date: new Date().toISOString(),
  platforms: Object.fromEntries(
    [...platforms.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, artifact]) => [
        target,
        {
          signature: readFileSync(artifact.signaturePath, "utf8").trim(),
          url: `${releaseBaseUrl}/${encodeURIComponent(githubAssetName(basename(artifact.artifactPath)))}`,
        },
      ]),
  ),
};

const outputPath = join(artifactsDir, "latest.json");
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated updater manifest: ${outputPath}`);
console.log(`Platforms: ${Object.keys(manifest.platforms).join(", ")}`);

function walk(root) {
  const entries = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...walk(path));
    } else if (stat.isFile()) {
      entries.push(path);
    }
  }
  return entries;
}

function platformTarget(artifactPath) {
  const name = basename(artifactPath);
  if (name === "Microwest-Whisper-windows.exe") return "windows-x86_64";
  if (name === "Microwest-Whisper-mac.app.tar.gz") return "darwin-aarch64";
  return null;
}

function githubAssetName(name) {
  return name.replaceAll(" ", ".");
}
