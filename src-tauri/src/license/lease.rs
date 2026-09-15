use ring::signature::{UnparsedPublicKey, ED25519};
use serde_json::Value;

const PUBLIC_KEY: &str = "0187a7675dcd5a8691d5ec6750ed60bf834b244cccea2dcb63d160795c44a61b";
const KEY_ID: &str = "iaswiss-2026-09-15";
const SIGNING_DOMAIN: &str = "IASWISS-LICENSE-LEASE-V1\n";
pub(super) fn normalize_key(value: &str) -> String {
    value
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_uppercase()
}
pub(super) fn verify_lease(
    envelope: &Value,
    license_key: &str,
    machine_id: &str,
    now: i64,
) -> Option<i64> {
    verify_with_key(
        envelope,
        license_key,
        machine_id,
        now,
        &hex::decode(PUBLIC_KEY).ok()?,
    )
}
fn verify_with_key(
    envelope: &Value,
    license_key: &str,
    machine_id: &str,
    now: i64,
    public_key: &[u8],
) -> Option<i64> {
    if envelope.get("keyId")?.as_str()? != KEY_ID {
        return None;
    }
    let payload = envelope.get("payload")?.as_str()?;
    if payload.len() > 4096 {
        return None;
    }
    let signature = hex::decode(envelope.get("signature")?.as_str()?).ok()?;
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(format!("{SIGNING_DOMAIN}{payload}").as_bytes(), &signature)
        .ok()?;
    let claims: Value = serde_json::from_str(payload).ok()?;
    let issued = claims.get("issuedAt")?.as_i64()?;
    let expires = claims.get("expiresAt")?.as_i64()?;
    if claims.get("version")?.as_u64()? != 1
        || claims.get("issuer")?.as_str()? != "iaswiss-licences"
        || claims.get("keyId")?.as_str()? != KEY_ID
        || claims.get("productSlug")?.as_str()? != "microwest-whisper"
        || claims.get("licenseKey")?.as_str()? != normalize_key(license_key)
        || claims.get("machineId")?.as_str()?
            != machine_id.trim().chars().take(160).collect::<String>()
        || license_key.trim().is_empty()
        || machine_id.trim().is_empty()
        || issued > now.checked_add(60)?
        || expires <= now
        || expires <= issued
        || expires.checked_sub(issued)? > 30 * 86400
    {
        return None;
    }
    Some(expires)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use serde_json::json;
    fn fixture() -> (Ed25519KeyPair, Value) {
        let key = Ed25519KeyPair::from_seed_unchecked(&[42; 32]).unwrap();
        let claims = json!({"version":1,"issuer":"iaswiss-licences","keyId":KEY_ID,"productSlug":"microwest-whisper","licenseKey":"MWTEST","machineId":"machine","issuedAt":1000,"expiresAt":2000});
        (key, claims)
    }
    fn sign(key: &Ed25519KeyPair, claims: &Value) -> Value {
        let payload = claims.to_string();
        json!({"keyId":KEY_ID,"signature":hex::encode(key.sign(format!("{SIGNING_DOMAIN}{payload}").as_bytes()).as_ref()),"payload":payload})
    }
    #[test]
    fn signed_lease_is_bound_to_product_device_key_and_time() {
        let (key, claims) = fixture();
        let envelope = sign(&key, &claims);
        let verify = |e: &Value, k, m, t| verify_with_key(e, k, m, t, key.public_key().as_ref());
        assert_eq!(verify(&envelope, "MW-TEST", "machine", 1500), Some(2000));
        assert_eq!(verify(&envelope, "MW-OTHER", "machine", 1500), None);
        assert_eq!(verify(&envelope, "MW-TEST", "other", 1500), None);
        assert_eq!(verify(&envelope, "MW-TEST", "machine", 2000), None);
        assert_eq!(verify(&envelope, "MW-TEST", "machine", 900), None);
        for (field, value) in [
            ("productSlug", json!("another-app")),
            ("issuer", json!("other")),
            ("version", json!(2)),
            ("expiresAt", json!(9_999_999)),
            ("expiresAt", json!(i64::MAX)),
        ] {
            let mut changed = claims.clone();
            changed[field] = value;
            assert_eq!(
                verify(&sign(&key, &changed), "MW-TEST", "machine", 1500),
                None
            );
        }
        let mut changed = envelope.clone();
        changed["payload"] = json!(format!("{} ", envelope["payload"].as_str().unwrap()));
        assert_eq!(verify(&changed, "MW-TEST", "machine", 1500), None);
        assert_eq!(
            verify_with_key(&envelope, "MW-TEST", "machine", 1500, &[0; 32]),
            None
        );
        assert_eq!(verify_lease(&envelope, "MW-TEST", "machine", 1500), None);
        assert_eq!(verify(&json!({}), "MW-TEST", "machine", 1500), None);
    }
}
