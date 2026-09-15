import { spawnSync } from "node:child_process";

const platforms = {
  "darwin-arm64": { target: "aarch64-apple-darwin", bundles: "app,dmg" },
  "win32-x64": { target: "x86_64-pc-windows-msvc", bundles: "nsis" },
};
const platform = platforms[`${process.platform}-${process.arch}`];
if (!platform) {
  throw new Error("Release builds support only Apple Silicon macOS and Windows x64 hosts.");
}

const buildEnv = { ...process.env };
if (!buildEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  delete buildEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, [
  "tauri", "build",
  "--config", "src-tauri/tauri.release.conf.json",
  "--target", platform.target,
  "--bundles", platform.bundles,
], {
  env: buildEnv,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) console.error(`Failed to start ${command}: ${result.error.message}`);
process.exit(result.status ?? 1);
