from __future__ import annotations

import json
import os
import platform
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


APP_VERSION = "0.1.1"
DEFAULT_API_BASE = "https://iaswiss.com/api/licenses"
LICENSE_STATE_PATH = Path(
    os.environ.get("MICROWEST_LICENSE_STATE")
    or (
        Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        / "Microwest Whisper"
        / "license.json"
        if platform.system() == "Windows"
        else Path.home()
        / ("Library/Application Support/Microwest Whisper" if platform.system() == "Darwin" else ".config/microwest-whisper")
        / "license.json"
    )
)


@dataclass(frozen=True)
class LicenseCheck:
    ok: bool
    message: str
    state: dict[str, Any]
    online: bool = False


def api_base() -> str:
    return os.environ.get("MICROWEST_LICENSE_API_BASE", DEFAULT_API_BASE).rstrip("/")


def license_bypass_enabled() -> bool:
    return os.environ.get("MICROWEST_LICENSE_BYPASS") == "1"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def read_state() -> dict[str, Any]:
    try:
        with LICENSE_STATE_PATH.open("r", encoding="utf-8") as handle:
            state = json.load(handle)
            return state if isinstance(state, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_state(state: dict[str, Any]) -> None:
    LICENSE_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LICENSE_STATE_PATH.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2)


def machine_id() -> str:
    state = read_state()
    existing = str(state.get("machine_id") or "").strip()
    if existing:
        return existing

    created = str(uuid.uuid4())
    state["machine_id"] = created
    write_state(state)
    return created


def post_json(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{api_base()}/{path.lstrip('/')}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": f"MicrowestWhisper/{APP_VERSION}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"ok": False, "reason": f"http_{exc.code}", "message": body}


def save_success(payload: dict[str, Any], license_key: str) -> dict[str, Any]:
    state = read_state()
    state.update(
        {
            "license_key": payload.get("licenseKey") or license_key,
            "product_name": payload.get("productName") or "Microwest Whisper",
            "product_slug": payload.get("productSlug") or "microwest-whisper",
            "release_url": payload.get("releaseUrl") or "",
            "valid_until": payload.get("validUntil") or "",
            "last_validated_at": now_utc().isoformat(),
            "machine_id": machine_id(),
        }
    )
    write_state(state)
    return state


def cached_license_valid(state: dict[str, Any] | None = None) -> bool:
    state = state if state is not None else read_state()
    valid_until = parse_datetime(str(state.get("valid_until") or ""))
    return bool(state.get("license_key")) and valid_until is not None and valid_until > now_utc()


def activate_license(license_key: str) -> LicenseCheck:
    license_key = license_key.strip()
    if not license_key:
        return LicenseCheck(False, "Clé de licence manquante.", read_state())

    try:
        payload = post_json(
            "activate",
            {
                "licenseKey": license_key,
                "machineId": machine_id(),
                "appVersion": APP_VERSION,
            },
        )
    except (OSError, TimeoutError, urllib.error.URLError) as exc:
        return LicenseCheck(False, f"Impossible d'activer la licence: {exc}", read_state())

    if payload.get("ok") is True:
        state = save_success(payload, license_key)
        return LicenseCheck(True, "Licence activée.", state, online=True)

    return LicenseCheck(False, license_error_message(str(payload.get("reason") or "unknown")), read_state(), online=True)


def validate_license(force_online: bool = False) -> LicenseCheck:
    if license_bypass_enabled():
        state = read_state()
        return LicenseCheck(True, "Licence ignorée en mode développement.", state)

    state = read_state()
    license_key = str(state.get("license_key") or "").strip()
    if not license_key:
        return LicenseCheck(False, "Aucune licence activée.", state)

    if not force_online and cached_license_valid(state):
        return LicenseCheck(True, "Licence valide.", state)

    try:
        payload = post_json(
            "validate",
            {
                "licenseKey": license_key,
                "machineId": machine_id(),
                "appVersion": APP_VERSION,
            },
        )
    except (OSError, TimeoutError, urllib.error.URLError) as exc:
        if cached_license_valid(state):
            return LicenseCheck(True, "Licence valide hors ligne temporairement.", state)
        return LicenseCheck(False, f"Impossible de vérifier la licence: {exc}", state)

    if payload.get("ok") is True:
        updated = save_success(payload, license_key)
        return LicenseCheck(True, "Licence valide.", updated, online=True)

    return LicenseCheck(False, license_error_message(str(payload.get("reason") or "unknown")), state, online=True)


def license_status_text(state: dict[str, Any] | None = None) -> str:
    state = state if state is not None else read_state()
    if not state.get("license_key"):
        return "Aucune licence activée."

    valid_until = str(state.get("valid_until") or "")
    parsed = parse_datetime(valid_until)
    if parsed and parsed > now_utc():
        return f"Licence valide jusqu'au {parsed.astimezone().strftime('%d.%m.%Y %H:%M')}."
    return "Licence à vérifier en ligne."


def license_error_message(reason: str) -> str:
    messages = {
        "invalid_license": "Clé de licence inconnue.",
        "revoked": "Licence révoquée.",
        "activation_limit_reached": "Nombre d'activations atteint.",
        "not_activated": "Licence non activée sur cette machine.",
        "missing_fields": "Demande de licence incomplète.",
        "server_error": "Erreur serveur pendant la vérification.",
    }
    return messages.get(reason, f"Licence refusée ({reason}).")
