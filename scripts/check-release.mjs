import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
function run(script, args = [], env = {}) {
  return spawnSync(process.execPath, [join(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_OS: "",
      GITHUB_REF_NAME: "",
      TAURI_SIGNING_PRIVATE_KEY: "",
      ...env,
    },
  });
}

for (const platform of ["macOS", "Windows"]) {
  test(`${platform} release requires updater key but no paid certificates`, () => {
    const missing = run("verify-release-secrets.mjs", [`--platform=${platform}`]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /TAURI_SIGNING_PRIVATE_KEY/);
    const ready = run("verify-release-secrets.mjs", [`--platform=${platform}`], {
      TAURI_SIGNING_PRIVATE_KEY: "test-only-key",
      GITHUB_REF_NAME: `v${version}`,
    });
    assert.equal(ready.status, 0, ready.stderr);
  });
}

test("preflight rejects unsupported platform and wrong release version", () => {
  const env = { TAURI_SIGNING_PRIVATE_KEY: "test-only-key" };
  assert.notEqual(run("verify-release-secrets.mjs", ["--platform=Linux"], env).status, 0);
  const wrongVersion = run("verify-release-secrets.mjs", ["--platform=macOS"], {
    ...env, GITHUB_REF_NAME: "v999.0.0",
  });
  assert.notEqual(wrongVersion.status, 0);
  assert.match(wrongVersion.stderr, /does not match application versions/);
});

function artifacts(t, { windows = true, mac = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "microwest-release-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Illustrative bytes only: CI and downloaded release verification check real bundles.
  for (const name of [
    ...(mac ? ["Microwest Whisper_0.3.4_aarch64.app.tar.gz"] : []),
    ...(windows ? ["Microwest Whisper_0.3.4_x64-setup.exe"] : []),
  ]) {
    writeFileSync(join(dir, name), "test-artifact");
    writeFileSync(join(dir, `${name}.sig`), `test-signature-for-${name}`);
  }
  writeFileSync(join(dir, "Microwest Whisper_0.3.4_aarch64.dmg"), "test-dmg");
  const normalized = run("normalize-release-assets.mjs", [dir]);
  assert.equal(normalized.status, 0, normalized.stderr);
  return dir;
}

function manifest(dir) {
  return run("generate-updater-manifest.mjs", [dir], {
    TAG_NAME: `v${version}`, GITHUB_REPOSITORY: "DwennK/Microwest-whisper",
  });
}

test("normalized assets keep matching signatures and publish only the two supported targets", (t) => {
  const dir = artifacts(t);
  const result = manifest(dir);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
  assert.equal(data.version, version);
  assert.deepEqual(Object.keys(data.platforms), ["darwin-aarch64", "windows-x86_64"]);
  for (const platform of Object.values(data.platforms)) {
    const name = decodeURIComponent(new URL(platform.url).pathname.split("/").pop());
    assert.ok(existsSync(join(dir, name)));
    assert.equal(platform.signature, readFileSync(join(dir, `${name}.sig`), "utf8"));
    assert.ok(platform.url.startsWith(`https://github.com/DwennK/Microwest-whisper/releases/download/v${version}/`));
  }
});

for (const missing of ["mac", "windows"]) {
  test(`manifest refuses a release missing ${missing}`, (t) => {
    const dir = artifacts(t, { [missing]: false });
    assert.notEqual(manifest(dir).status, 0);
    assert.equal(existsSync(join(dir, "latest.json")), false);
  });
}

test("manifest rejects empty, orphaned and Linux signatures", (t) => {
  const dir = artifacts(t);
  const signature = join(dir, "Microwest-Whisper-windows.exe.sig");
  writeFileSync(signature, " \n");
  assert.match(manifest(dir).stderr, /Empty updater signature/);
  writeFileSync(signature, "test-signature");
  writeFileSync(join(dir, "orphan.sig"), "test-signature");
  assert.match(manifest(dir).stderr, /has no artifact/);
  rmSync(join(dir, "orphan.sig"));
  writeFileSync(join(dir, "old.AppImage"), "test-artifact");
  writeFileSync(join(dir, "old.AppImage.sig"), "test-signature");
  assert.match(manifest(dir).stderr, /Unsupported updater artifact/);
});
