use chrono::{DateTime, Utc};
mod lease;
use serde::Serialize;
use serde_json::{json, Map, Value};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{env, fs, io::Write, path::PathBuf};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_API_BASE: &str = "https://licences.iaswiss.com/api/licenses";

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

    let (machine_id, request_id) = begin_request(&license_key)?;
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
        let state = save_success(&payload, &license_key, &machine_id, &request_id)?;
        return Ok(LicenseCheck {
            ok: true,
            message: "Licence activée.".to_string(),
            state,
            online: true,
        });
    }

    let state = save_refusal(&payload, &license_key, &request_id)?;
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

#[tauri::command]
pub async fn validate_license(force_online: bool) -> Result<LicenseCheck, String> {
    if development_bypass() {
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

    let (machine_id, request_id) = begin_request(&license_key)?;
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
            let state = read_state();
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
        let updated = save_success(&payload, &license_key, &machine_id, &request_id)?;
        return Ok(LicenseCheck {
            ok: true,
            message: "Licence valide.".to_string(),
            state: updated,
            online: true,
        });
    }

    let state = save_refusal(&payload, &license_key, &request_id)?;
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
    if development_bypass() {
        return Ok(());
    }

    let state = read_state();
    if cached_license_valid(&state) {
        return Ok(());
    }

    Err(license_status_text(&state))
}

fn development_bypass() -> bool {
    cfg!(debug_assertions) && env::var("MICROWEST_LICENSE_BYPASS").ok().as_deref() == Some("1")
}
fn api_base() -> String {
    if cfg!(debug_assertions) {
        if let Ok(value) = env::var("MICROWEST_LICENSE_API_BASE") {
            return value.trim_end_matches('/').to_string();
        }
    }
    DEFAULT_API_BASE.to_string()
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
    let Ok(_guard) = lock_state_path(&license_state_path()) else {
        return json!({"storage_error": true});
    };
    read_state_unlocked()
}

fn read_state_unlocked() -> Value {
    let path = license_state_path();
    let Ok(content) = fs::read_to_string(path) else {
        return json!({});
    };
    match serde_json::from_str::<Value>(&content) {
        Ok(Value::Object(map)) => Value::Object(map),
        _ => json!({}),
    }
}

// The lock file keeps a stable inode while license.json is atomically replaced.
// Every read/modify/write path holds this OS lock across all app instances.
fn lock_state_path(path: &PathBuf) -> Result<fs::File, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut options = fs::OpenOptions::new();
    options.create(true).read(true).write(true).truncate(false);
    #[cfg(unix)]
    options.mode(0o600);
    let file = options
        .open(path.with_extension("lock"))
        .map_err(|e| e.to_string())?;
    file.lock().map_err(|e| e.to_string())?;
    Ok(file)
}

fn write_state(state: &Value) -> Result<(), String> {
    let path = license_state_path();
    let content = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = write_private_file(&temporary, &content)
        .and_then(|_| fs::rename(&temporary, &path).map_err(|e| e.to_string()));
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn write_private_file(path: &PathBuf, content: &[u8]) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.create(true).write(true).truncate(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|e| e.to_string())?;
    file.write_all(content).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

fn object_mut(state: &mut Value) -> &mut Map<String, Value> {
    if !state.is_object() {
        *state = json!({});
    }
    state.as_object_mut().expect("state object")
}

fn begin_request(license_key: &str) -> Result<(String, String), String> {
    let _guard = lock_state_path(&license_state_path())?;
    let mut state = read_state_unlocked();
    let machine_id = state
        .get("machine_id")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let request_id = uuid::Uuid::new_v4().to_string();
    let object = object_mut(&mut state);
    object.insert("machine_id".into(), json!(machine_id));
    object.insert("validation_request".into(), json!(request_id));
    object.insert("pending_license_key".into(), json!(license_key));
    write_state(&state)?;
    Ok((machine_id, request_id))
}

async fn post_json(path: &str, payload: Value) -> Result<Value, String> {
    let url = format!("{}/{}", api_base(), path.trim_start_matches('/'));
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", format!("MicrowestWhisper/{APP_VERSION}"))
        .json(&payload)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    if status.is_server_error() || status.as_u16() == 429 {
        return Err(format!("Service temporairement indisponible ({status})."));
    }
    let text = response.text().await.map_err(|error| error.to_string())?;
    let payload: Value =
        serde_json::from_str(&text).map_err(|_| "Réponse de licence invalide.".to_string())?;
    if status.as_u16() == 200 && payload.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(payload);
    }
    if status.as_u16() == 403
        && payload.get("ok").and_then(Value::as_bool) == Some(false)
        && definitive_refusal(payload.get("reason").and_then(Value::as_str).unwrap_or(""))
    {
        return Ok(payload);
    }
    Err(format!("Réponse de licence inattendue ({status})."))
}

fn definitive_refusal(reason: &str) -> bool {
    matches!(
        reason,
        "revoked"
            | "invalid_license"
            | "subscription_inactive"
            | "not_activated"
            | "activation_limit_reached"
    )
}

fn apply_refusal(state: &mut Value, payload: &Value, license_key: &str, _request_id: &str) -> bool {
    if !definitive_refusal(payload.get("reason").and_then(Value::as_str).unwrap_or("")) {
        return false;
    }
    let requested = lease::normalize_key(license_key);
    let current = lease::normalize_key(
        state
            .get("license_key")
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
    let pending = lease::normalize_key(
        state
            .get("pending_license_key")
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
    if requested.is_empty() || (requested != current && requested != pending) {
        return false;
    }
    let object = object_mut(state);
    // A denial also fences pending first activations, before a key has ever been saved.
    object.remove("validation_request");
    object.remove("pending_license_key");
    if requested == current {
        object.remove("lease");
        object.remove("valid_until");
        object.insert("denied_reason".into(), payload["reason"].clone());
    }
    true
}

fn save_refusal(payload: &Value, license_key: &str, request_id: &str) -> Result<Value, String> {
    let _guard = lock_state_path(&license_state_path())?;
    let mut state = read_state_unlocked();
    if apply_refusal(&mut state, payload, license_key, request_id) {
        write_state(&state)?;
    }
    Ok(state)
}

fn save_success(
    payload: &Value,
    license_key: &str,
    current_machine_id: &str,
    request_id: &str,
) -> Result<Value, String> {
    let _guard = lock_state_path(&license_state_path())?;
    let mut state = read_state_unlocked();
    if state.get("validation_request").and_then(Value::as_str) != Some(request_id) {
        return Err("Une vérification plus récente a remplacé cette réponse.".into());
    }
    let signed_lease = payload
        .get("lease")
        .ok_or("Le serveur n'a pas fourni de droit signé.")?;
    let expires = lease::verify_lease(
        signed_lease,
        license_key,
        current_machine_id,
        Utc::now().timestamp(),
    )
    .ok_or("Signature de licence invalide ou expirée.")?;
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
    object.insert("lease".into(), signed_lease.clone());
    object.insert("license_key".into(), json!(license_key));
    object.insert(
        "valid_until".into(),
        json!(DateTime::from_timestamp(expires, 0)
            .ok_or("Date de licence invalide.")?
            .to_rfc3339()),
    );
    object.remove("denied_reason");
    object.remove("pending_license_key");
    write_state(&state)?;
    Ok(state)
}

fn cached_license_valid(state: &Value) -> bool {
    cached_license_expiry(state).is_some()
}
fn cached_license_expiry(state: &Value) -> Option<i64> {
    if state.get("denied_reason").is_some() {
        return None;
    }
    lease::verify_lease(
        state.get("lease")?,
        state.get("license_key")?.as_str()?,
        state.get("machine_id")?.as_str()?,
        Utc::now().timestamp(),
    )
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

    if let Some(reason) = state.get("denied_reason").and_then(Value::as_str) {
        return license_error_message(reason);
    }
    let valid_until =
        cached_license_expiry(state).and_then(|seconds| DateTime::from_timestamp(seconds, 0));
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

    #[test]
    fn unsigned_cache_and_forged_future_expiry_do_not_authorize() {
        let forged = json!({"license_key":"MW-TEST","machine_id":"machine","valid_until":"2099-01-01T00:00:00Z"});
        assert!(!cached_license_valid(&forged));
        assert_eq!(license_status_text(&forged), "Licence à vérifier en ligne.");
    }
    #[test]
    fn refusal_survives_serialization_and_only_invalidates_the_concerned_key() {
        let mut state = json!({"license_key":"MW-TEST","machine_id":"machine","lease":{"payload":"old"},"valid_until":"2099-01-01T00:00:00Z","validation_request":"current"});
        let denial = json!({"ok":false,"reason":"revoked"});
        assert!(!apply_refusal(&mut state, &denial, "MW-OTHER", "current"));
        assert!(!apply_refusal(
            &mut state,
            &json!({"reason":"server_error"}),
            "MW-TEST",
            "current"
        ));
        assert!(state.get("lease").is_some());
        assert!(apply_refusal(&mut state, &denial, "MW-TEST", "older"));
        assert!(state.get("validation_request").is_none());
        let restarted: Value = serde_json::from_str(&state.to_string()).unwrap();
        assert!(restarted.get("lease").is_none());
        assert!(restarted.get("valid_until").is_none());
        assert!(!cached_license_valid(&restarted));
        assert_eq!(license_status_text(&restarted), "Licence révoquée.");
    }

    #[test]
    fn refusal_fences_an_in_flight_first_activation_without_erasing_another_key() {
        for current in ["", "MW-EXISTING"] {
            let mut state = json!({"license_key":current,"lease":{"payload":"existing"},"validation_request":"newest","pending_license_key":"MW-NEW"});
            assert!(apply_refusal(
                &mut state,
                &json!({"reason":"revoked"}),
                "MW-NEW",
                "older"
            ));
            assert!(state.get("validation_request").is_none());
            assert!(state.get("pending_license_key").is_none());
            assert_eq!(state["license_key"], current);
            assert_eq!(state["lease"]["payload"], "existing");
        }
    }

    #[test]
    #[ignore = "subprocess helper; invoked by state_lock_serializes_app_instances"]
    fn process_lock_helper() {
        let path = license_state_path();
        fs::write(path.with_extension("waiting"), b"ready").unwrap();
        begin_request("MW-TEST").unwrap();
    }

    #[test]
    fn state_lock_serializes_app_instances() {
        let root = env::temp_dir().join(format!("microwest-multiprocess-{}", uuid::Uuid::new_v4()));
        let path = root.join("license.json");
        let guard = lock_state_path(&path).unwrap();
        write_private_file(
            &path,
            br#"{"license_key":"MW-TEST","lease":{"payload":"old"}}"#,
        )
        .unwrap();
        let mut child = std::process::Command::new(env::current_exe().unwrap())
            .args([
                "--exact",
                "license::tests::process_lock_helper",
                "--ignored",
            ])
            .env("MICROWEST_LICENSE_STATE", &path)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !path.with_extension("waiting").exists() {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(
            child.try_wait().unwrap().is_none(),
            "second instance must wait before reading state"
        );
        write_private_file(
            &path,
            br#"{"license_key":"MW-TEST","denied_reason":"revoked"}"#,
        )
        .unwrap();
        drop(guard);
        assert!(child.wait().unwrap().success());
        let state: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(state["denied_reason"], "revoked");
        assert!(state.get("lease").is_none());
        assert!(!cached_license_valid(&state));
        fs::remove_dir_all(root).unwrap();
    }

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
