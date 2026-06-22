use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{env, fs, io::Write, path::PathBuf};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_API_BASE: &str = "https://iaswiss.com/api/licenses";

#[derive(Debug, Serialize)]
pub struct LicenseSnapshot {
    state: Value,
    status_text: String,
    cached_valid: bool,
}

#[derive(Debug, Serialize)]
pub struct LicenseCheck {
    ok: bool,
    message: String,
    state: Value,
    online: bool,
}

#[tauri::command]
pub fn read_license_state() -> LicenseSnapshot {
    let state = read_state();
    LicenseSnapshot {
        status_text: license_status_text(&state),
        cached_valid: cached_license_valid(&state),
        state,
    }
}

#[tauri::command]
pub async fn activate_license(license_key: String) -> Result<LicenseCheck, String> {
    let license_key = license_key.trim().to_string();
    if license_key.is_empty() {
        return Ok(LicenseCheck {
            ok: false,
            message: "Clé de licence manquante.".to_string(),
            state: read_state(),
            online: false,
        });
    }

    let machine_id = machine_id()?;
    let payload = match post_json(
        "activate",
        json!({
            "licenseKey": license_key,
            "machineId": machine_id,
            "appVersion": APP_VERSION,
        }),
    )
    .await
    {
        Ok(payload) => payload,
        Err(error) => {
            return Ok(LicenseCheck {
                ok: false,
                message: format!("Impossible d'activer la licence: {error}"),
                state: read_state(),
                online: false,
            });
        }
    };

    if payload.get("ok").and_then(Value::as_bool) == Some(true) {
        let state = save_success(&payload, &license_key)?;
        return Ok(LicenseCheck {
            ok: true,
            message: "Licence activée.".to_string(),
            state,
            online: true,
        });
    }

    Ok(LicenseCheck {
        ok: false,
        message: license_error_message(
            payload
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
        ),
        state: read_state(),
        online: true,
    })
}

#[tauri::command]
pub async fn validate_license(force_online: bool) -> Result<LicenseCheck, String> {
    if env::var("MICROWEST_LICENSE_BYPASS").ok().as_deref() == Some("1") {
        return Ok(LicenseCheck {
            ok: true,
            message: "Licence ignorée en mode développement.".to_string(),
            state: read_state(),
            online: false,
        });
    }

    let state = read_state();
    let license_key = state
        .get("license_key")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    if license_key.is_empty() {
        return Ok(LicenseCheck {
            ok: false,
            message: "Aucune licence activée.".to_string(),
            state,
            online: false,
        });
    }

    if !force_online && cached_license_valid(&state) {
        return Ok(LicenseCheck {
            ok: true,
            message: "Licence valide.".to_string(),
            state,
            online: false,
        });
    }

    let machine_id = machine_id()?;
    let payload = match post_json(
        "validate",
        json!({
            "licenseKey": license_key,
            "machineId": machine_id,
            "appVersion": APP_VERSION,
        }),
    )
    .await
    {
        Ok(payload) => payload,
        Err(error) => {
            if cached_license_valid(&state) {
                return Ok(LicenseCheck {
                    ok: true,
                    message: "Licence valide hors ligne temporairement.".to_string(),
                    state,
                    online: false,
                });
            }
            return Ok(LicenseCheck {
                ok: false,
                message: format!("Impossible de vérifier la licence: {error}"),
                state,
                online: false,
            });
        }
    };

    if payload.get("ok").and_then(Value::as_bool) == Some(true) {
        let updated = save_success(&payload, &license_key)?;
        return Ok(LicenseCheck {
            ok: true,
            message: "Licence valide.".to_string(),
            state: updated,
            online: true,
        });
    }

    Ok(LicenseCheck {
        ok: false,
        message: license_error_message(
            payload
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
        ),
        state,
        online: true,
    })
}

pub fn local_license_allows_run() -> Result<(), String> {
    if env::var("MICROWEST_LICENSE_BYPASS").ok().as_deref() == Some("1") {
        return Ok(());
    }

    let state = read_state();
    if cached_license_valid(&state) {
        return Ok(());
    }

    Err(license_status_text(&state))
}

fn api_base() -> String {
    env::var("MICROWEST_LICENSE_API_BASE")
        .unwrap_or_else(|_| DEFAULT_API_BASE.to_string())
        .trim_end_matches('/')
        .to_string()
}

pub fn license_state_path() -> PathBuf {
    if let Ok(path) = env::var("MICROWEST_LICENSE_STATE") {
        return PathBuf::from(path);
    }

    if cfg!(target_os = "windows") {
        let appdata = env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| dirs_next::home_dir().map(|home| home.join("AppData").join("Roaming")))
            .unwrap_or_else(|| PathBuf::from("."));
        return appdata.join("Microwest Whisper").join("license.json");
    }

    let home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "macos") {
        home.join("Library")
            .join("Application Support")
            .join("Microwest Whisper")
            .join("license.json")
    } else {
        home.join(".config")
            .join("microwest-whisper")
            .join("license.json")
    }
}

fn read_state() -> Value {
    let path = license_state_path();
    let Ok(content) = fs::read_to_string(path) else {
        return json!({});
    };
    match serde_json::from_str::<Value>(&content) {
        Ok(Value::Object(map)) => Value::Object(map),
        _ => json!({}),
    }
}

fn write_state(state: &Value) -> Result<(), String> {
    let path = license_state_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    write_private_file(&path, content.as_bytes())
}

#[cfg(unix)]
fn write_private_file(path: &PathBuf, content: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(content).map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())
}

#[cfg(not(unix))]
fn write_private_file(path: &PathBuf, content: &[u8]) -> Result<(), String> {
    fs::write(path, content).map_err(|error| error.to_string())
}

fn object_mut(state: &mut Value) -> &mut Map<String, Value> {
    if !state.is_object() {
        *state = json!({});
    }
    state.as_object_mut().expect("state object")
}

fn machine_id() -> Result<String, String> {
    let mut state = read_state();
    if let Some(existing) = state
        .get("machine_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(existing.to_string());
    }

    let created = uuid::Uuid::new_v4().to_string();
    object_mut(&mut state).insert("machine_id".to_string(), json!(created));
    write_state(&state)?;
    Ok(created)
}

async fn post_json(path: &str, payload: Value) -> Result<Value, String> {
    let url = format!("{}/{}", api_base(), path.trim_start_matches('/'));
    let response = reqwest::Client::new()
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", format!("MicrowestWhisper/{APP_VERSION}"))
        .json(&payload)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    serde_json::from_str::<Value>(&text).or_else(|_| {
        Ok(json!({
            "ok": false,
            "reason": format!("http_{}", status.as_u16()),
            "message": text,
        }))
    })
}

fn save_success(payload: &Value, license_key: &str) -> Result<Value, String> {
    let current_machine_id = machine_id()?;
    let mut state = read_state();
    let object = object_mut(&mut state);
    object.insert(
        "license_key".to_string(),
        json!(payload
            .get("licenseKey")
            .and_then(Value::as_str)
            .unwrap_or(license_key)),
    );
    object.insert(
        "product_name".to_string(),
        json!(payload
            .get("productName")
            .and_then(Value::as_str)
            .unwrap_or("Microwest Whisper")),
    );
    object.insert(
        "product_slug".to_string(),
        json!(payload
            .get("productSlug")
            .and_then(Value::as_str)
            .unwrap_or("microwest-whisper")),
    );
    object.insert(
        "release_url".to_string(),
        json!(payload
            .get("releaseUrl")
            .and_then(Value::as_str)
            .unwrap_or_default()),
    );
    object.insert(
        "subscription_status".to_string(),
        json!(payload
            .get("subscriptionStatus")
            .and_then(Value::as_str)
            .unwrap_or_default()),
    );
    object.insert(
        "valid_until".to_string(),
        json!(payload
            .get("validUntil")
            .and_then(Value::as_str)
            .unwrap_or_default()),
    );
    object.insert(
        "last_validated_at".to_string(),
        json!(Utc::now().to_rfc3339()),
    );
    object.insert("machine_id".to_string(), json!(current_machine_id));
    write_state(&state)?;
    Ok(state)
}

fn parse_datetime(value: &str) -> Option<DateTime<Utc>> {
    if value.trim().is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(&value.replace('Z', "+00:00"))
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn cached_license_valid(state: &Value) -> bool {
    let Some(license_key) = state.get("license_key").and_then(Value::as_str) else {
        return false;
    };
    if license_key.trim().is_empty() {
        return false;
    }
    state
        .get("valid_until")
        .and_then(Value::as_str)
        .and_then(parse_datetime)
        .map(|valid_until| valid_until > Utc::now())
        .unwrap_or(false)
}

fn license_status_text(state: &Value) -> String {
    if state
        .get("license_key")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .is_empty()
    {
        return "Aucune licence activée.".to_string();
    }

    let valid_until = state
        .get("valid_until")
        .and_then(Value::as_str)
        .and_then(parse_datetime);
    if let Some(valid_until) = valid_until.filter(|value| *value > Utc::now()) {
        let subscription_status = state
            .get("subscription_status")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or("active");
        return format!(
            "Abonnement {subscription_status}. Licence valide jusqu'au {}.",
            valid_until
                .with_timezone(&chrono::Local)
                .format("%d.%m.%Y %H:%M")
        );
    }

    "Licence à vérifier en ligne.".to_string()
}

fn license_error_message(reason: &str) -> String {
    match reason {
        "invalid_license" => "Clé de licence inconnue.".to_string(),
        "revoked" => "Licence révoquée.".to_string(),
        "activation_limit_reached" => "Nombre d'activations atteint.".to_string(),
        "not_activated" => "Licence non activée sur cette machine.".to_string(),
        "subscription_inactive" => "Abonnement inactif ou paiement non à jour.".to_string(),
        "missing_fields" => "Demande de licence incomplète.".to_string(),
        "server_error" => "Erreur serveur pendant la vérification.".to_string(),
        other => format!("Licence refusée ({other})."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[cfg(unix)]
    #[test]
    fn writes_license_state_with_private_file_permissions() {
        let root = env::temp_dir().join(format!("microwest-license-test-{}", uuid::Uuid::new_v4()));
        let path = root.join("license.json");
        fs::create_dir_all(&root).unwrap();

        let content = serde_json::to_vec_pretty(&json!({
            "license_key": "MW-TEST",
            "valid_until": "2099-01-01T00:00:00Z"
        }))
        .unwrap();
        write_private_file(&path, &content).unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);

        let _ = fs::remove_dir_all(root);
    }
}
