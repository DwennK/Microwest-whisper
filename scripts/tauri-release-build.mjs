import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const configs = ["src-tauri/tauri.release.conf.json"];

if (process.platform === "win32" && process.env.WINDOWS_CERTIFICATE_THUMBPRINT) {
  const signingConfigPath = join("src-tauri", "tauri.windows-signing.local.json");
  const signingConfig = {
    bundle: {
      windows: {
        certificateThumbprint: process.env.WINDOWS_CERTIFICATE_THUMBPRINT,
        digestAlgorithm: process.env.WINDOWS_DIGEST_ALGORITHM || "sha256",
        timestampUrl: process.env.WINDOWS_TIMESTAMP_URL || "http://timestamp.digicert.com",
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
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
