const platform = (process.env.RUNNER_OS || process.argv.find((argument) => argument.startsWith("--platform="))?.split("=")[1] || "").toLowerCase();

if (!platform) {
  throw new Error("Release signing preflight requires RUNNER_OS or --platform=<macOS|Windows|Linux>.");
}

const missing = [];
requireValues(["TAURI_SIGNING_PRIVATE_KEY"]);

if (platform === "macos") {
  requireValues(["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY"]);
  const appleIdCredentials = hasValues(["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]);
  const appStoreConnectCredentials = hasValues(["APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_PRIVATE"]);
  if (!appleIdCredentials && !appStoreConnectCredentials) {
    missing.push("Apple notarization credentials (APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID, or APPLE_API_KEY + APPLE_API_ISSUER + APPLE_API_KEY_PRIVATE)");
  }
}

if (platform === "windows") {
  requireValues([
    "WINDOWS_CERTIFICATE_BASE64",
    "WINDOWS_CERTIFICATE_PASSWORD",
    "WINDOWS_CERTIFICATE_THUMBPRINT",
  ]);
}

if (missing.length > 0) {
  throw new Error(`Signed release preflight failed for ${platform}:\n- ${missing.join("\n- ")}`);
}

console.log(`Signed release preflight passed for ${platform}.`);

function hasValues(names) {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

function requireValues(names) {
  for (const name of names) {
    if (!process.env[name]?.trim()) missing.push(name);
  }
}
