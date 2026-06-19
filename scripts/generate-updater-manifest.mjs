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
    continue;
  }

  const target = platformTarget(artifactPath);
  if (!target) {
    continue;
  }

  const candidate = {
    priority: artifactPriority(artifactPath),
    signaturePath,
    artifactPath,
  };
  const previous = platforms.get(target);
  if (!previous || candidate.priority > previous.priority) {
    platforms.set(target, candidate);
  }
}

if (platforms.size === 0) {
  throw new Error(`No signed updater artifacts were found in ${artifactsDir}`);
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
  const lowerPath = artifactPath.toLowerCase().replace(/\\/g, "/");
  const lowerName = basename(artifactPath).toLowerCase();

  if (lowerName.endsWith(".exe") || lowerName.endsWith(".msi") || lowerName.endsWith(".nsis.zip") || lowerName.endsWith(".msi.zip")) {
    return "windows-x86_64";
  }

  if (lowerName.endsWith(".appimage") || lowerName.endsWith(".appimage.tar.gz") || lowerPath.includes("/appimage/")) {
    return lowerName.includes("aarch64") || lowerName.includes("arm64") ? "linux-aarch64" : "linux-x86_64";
  }

  if (lowerName.endsWith(".app.tar.gz") || lowerPath.includes("/macos/")) {
    if (lowerName.includes("x86_64") || lowerName.includes("x64") || lowerName.includes("intel")) {
      return "darwin-x86_64";
    }
    if (lowerName.includes("aarch64") || lowerName.includes("arm64")) {
      return "darwin-aarch64";
    }
    return process.env.MACOS_UPDATER_TARGET ?? "darwin-aarch64";
  }

  return null;
}

function artifactPriority(artifactPath) {
  const lowerName = basename(artifactPath).toLowerCase();
  if (lowerName.endsWith(".exe") || lowerName.endsWith(".nsis.zip")) {
    return 100;
  }
  if (lowerName.endsWith(".msi") || lowerName.endsWith(".msi.zip")) {
    return 80;
  }
  return 50;
}

function githubAssetName(name) {
  return name.replaceAll(" ", ".");
}
