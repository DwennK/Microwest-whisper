import { readFileSync } from "node:fs";

const platform = (process.env.RUNNER_OS || process.argv.find((argument) => argument.startsWith("--platform="))?.split("=")[1] || "").toLowerCase();
if (!["macos", "windows"].includes(platform)) {
  throw new Error("Release preflight supports only macOS and Windows.");
}
if (!process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
  throw new Error("Release preflight requires TAURI_SIGNING_PRIVATE_KEY to protect automatic updates.");
}

const tag = process.env.GITHUB_REF_NAME;
if (tag) {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const versions = [
    JSON.parse(read("package.json")).version,
    JSON.parse(read("src-tauri/tauri.conf.json")).version,
    read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1],
  ];
  if (versions.some((version) => `v${version}` !== tag)) {
    throw new Error(`Release tag ${tag} does not match application versions: ${versions.join(", ")}`);
  }
}

console.log(`Release preflight passed for ${platform}; updater signing required, paid OS certificates not required.`);
