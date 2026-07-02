import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const configs = ["src-tauri/tauri.release.conf.json"];
const buildEnv = { ...process.env };

for (const name of [
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
  "APPLE_API_KEY",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY_PATH",
  "APPLE_PROVIDER_SHORT_NAME",
  "WINDOWS_CERTIFICATE_THUMBPRINT",
  "WINDOWS_DIGEST_ALGORITHM",
  "WINDOWS_TIMESTAMP_URL",
]) {
  if (!buildEnv[name]) {
    delete buildEnv[name];
  }
}

if (process.platform === "win32" && buildEnv.WINDOWS_CERTIFICATE_THUMBPRINT) {
  const signingConfigPath = join("src-tauri", "tauri.windows-signing.local.json");
  const signingConfig = {
    bundle: {
      windows: {
        certificateThumbprint: buildEnv.WINDOWS_CERTIFICATE_THUMBPRINT,
        digestAlgorithm: buildEnv.WINDOWS_DIGEST_ALGORITHM || "sha256",
        timestampUrl: buildEnv.WINDOWS_TIMESTAMP_URL || "http://timestamp.digicert.com",
      },
    },
  };

  writeFileSync(signingConfigPath, `${JSON.stringify(signingConfig, null, 2)}\n`);
  configs.push(signingConfigPath);
  console.log(`Windows code signing enabled with ${signingConfigPath}`);
} else if (process.platform === "win32") {
  console.log("Windows code signing secrets are not configured; building unsigned Windows installers.");
}

const args = ["tauri", "build"];
for (const config of configs) {
  args.push("--config", config);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, args, {
  env: buildEnv,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to start ${command}: ${result.error.message}`);
}

process.exit(result.status ?? 1);
