use aes_gcm::{aead::{Aead, Payload}, Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, SigningKey, VerifyingKey};
use hkdf::Hkdf;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub type Result<T> = std::result::Result<T, &'static str>;
pub const FIELD_NAMES: [&str; 6] = ["course", "achievement", "learner", "score", "completed", "reference"];
pub const FIELD_INDEXES: [usize; 6] = [3, 4, 5, 6, 7, 10];
pub const MANDATORY: [usize; 5] = [0, 1, 2, 8, 9];
pub fn digest(bytes: &[u8]) -> String { hex::encode(Sha256::digest(bytes)) }
pub fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> { value[key].as_str().ok_or("packet_invalid") }
pub fn canonical(value: &Value) -> Result<Vec<u8>> { serde_json::to_vec(value).map_err(|_| "packet_invalid") }
pub fn key32(value: &str) -> Result<[u8; 32]> { hex::decode(value).map_err(|_| "key_invalid")?.try_into().map_err(|_| "key_invalid") }
fn exact_keys(value: &Value, keys: &[&str]) -> Result<()> { let object = value.as_object().ok_or("packet_invalid")?; if object.len() != keys.len() || object.keys().any(|k| !keys.contains(&k.as_str())) { return Err("excess_disclosure"); } Ok(()) }
pub fn check_signature(value: &Value, signature: &str, owner: &str) -> Result<()> {
    let bytes = STANDARD.decode(signature).map_err(|_| "approval_invalid")?;
    let signature = Signature::from_slice(&bytes).map_err(|_| "approval_invalid")?;
    let public = VerifyingKey::from_bytes(&key32(owner)?).map_err(|_| "approval_invalid")?;
    public.verify_strict(&canonical(value)?, &signature).map_err(|_| "approval_invalid")
}
pub fn validate_copy(packet: &Value, input: &Value) -> Result<()> {
    if packet["version"] != "facet-private-copy-v1" { return Err("copy_invalid"); }
    let seed = key32(text(packet, "holder_seed")?)?;
    if hex::encode(SigningKey::from_bytes(&seed).verifying_key().to_bytes()) != text(input, "owner_id")? { return Err("holder_binding_failed"); }
    let doc = &packet["document"]; let record = &input["record"];
    if doc["id"] != input["token_id"] || doc["commitment"] != record["commitment"] || doc["record"]["owner_id"] != input["owner_id"] || doc["record"]["token_id"] != input["token_id"] { return Err("document_binding_failed"); }
    let data = STANDARD.decode(text(doc, "data")?).map_err(|_| "document_invalid")?;
    if data.len() > 65536 { return Err("document_too_large"); }
    let salt = hex::decode(text(doc, "salt")?).map_err(|_| "document_invalid")?;
    if salt.len() < 16 || salt.len() > 64 { return Err("document_invalid"); }
    let mut source = salt; source.extend_from_slice(&data);
    if digest(&source) != text(record, "commitment")? { return Err("document_commitment_failed"); }
    if !doc["credential"].is_null() {
        let credential = &doc["credential"]; let messages = credential["messages"].as_array().ok_or("credential_invalid")?;
        if messages.len() != 11 || messages[0] != input["owner_id"] || messages[1] != input["token_id"] || messages[2] != "CourseCompletionCredential" || messages[8] != record["expires_at"].to_string() || messages[9] != record["commitment"] || credential["token_id"] != input["token_id"] || credential["record"]["owner_id"] != input["owner_id"] { return Err("credential_binding_failed"); }
    }
    Ok(())
}
pub fn mask(fields: &Value) -> Result<u64> {
    let mut out = 0;
    for field in fields.as_array().ok_or("fields_invalid")? {
        let index = FIELD_NAMES.iter().position(|s| Some(*s) == field.as_str()).ok_or("fields_invalid")?;
        if out & (1 << index) != 0 { return Err("fields_invalid"); } out |= 1 << index;
    }
    if out == 0 { return Err("fields_invalid"); } Ok(out)
}
pub fn indexes(bits: u64) -> Vec<usize> { let mut out = MANDATORY.to_vec(); for (i, index) in FIELD_INDEXES.iter().enumerate() { if bits & (1 << i) != 0 { out.push(*index); } } out.sort_unstable(); out }
pub fn validate_grant(packet: &Value, input: &Value, copy: &Value) -> Result<()> {
    let grant = &input["grant"];
    if packet["version"] != "facet-private-grant-v1" || packet["grant_id"] != grant["id"] || packet["owner_id"] != input["owner_id"] || packet["token_id"] != input["token_id"] || packet["copy_hash"] != grant["copy_hash"] || digest(&canonical(copy)?) != text(grant, "copy_hash")? { return Err("grant_binding_failed"); }
    let delivery = text(packet, "delivery_key")?; key32(delivery)?;
    let auth_seed: [u8; 32] = Sha256::digest(format!("facet-agent-auth-v1:{}", delivery).as_bytes()).into();
    if digest(delivery.as_bytes()) != text(grant, "delivery_key_hash")? || hex::encode(SigningKey::from_bytes(&auth_seed).verifying_key().to_bytes()) != text(grant, "auth_key")? { return Err("delivery_binding_failed"); }
    let bits = grant["fields_mask"].as_u64().ok_or("fields_invalid")?;
    if bits == 0 || bits > 63 { return Err("fields_invalid"); }
    let expected = indexes(bits); let proofs = packet["presentations"].as_array().ok_or("grant_invalid")?;
    let uses = grant["max_uses"].as_u64().ok_or("grant_invalid")? as usize;
    if uses == 0 || uses > 3 || proofs.len() != uses { return Err("grant_invalid"); }
    let messages = copy["document"]["credential"]["messages"].as_array().ok_or("credential_missing")?;
    let mut nonces = Vec::new();
    for proof in proofs {
        exact_keys(proof, &["version", "token_id", "request", "proof", "disclosed", "holder_signature"])?;
        let request = &proof["request"]; let payload = &request["payload"];
        exact_keys(request, &["payload", "signature"])?;
        exact_keys(payload, &["version", "nonce", "audience", "purpose", "fields", "created_at", "expires_at"])?;
        if proof["version"] != "facet-presentation-v1" || proof["token_id"] != input["token_id"] || payload["version"] != "facet-request-v1" || payload["audience"] != grant["agent_id"] || payload["expires_at"] != grant["expires_at"] || mask(&payload["fields"])? != bits || digest(text(payload, "purpose")?.as_bytes()) != text(grant, "purpose_hash")? { return Err("request_binding_failed"); }
        let nonce = text(payload, "nonce")?;
        if nonce.len() != 32 || !nonce.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) || nonces.contains(&nonce) { return Err("request_reused"); } nonces.push(nonce);
        let created = payload["created_at"].as_u64().ok_or("request_binding_failed")?;
        let expires = payload["expires_at"].as_u64().ok_or("request_binding_failed")?;
        if expires <= created || expires - created > 900000 { return Err("request_binding_failed"); }
        let revealed = proof["disclosed"].as_array().ok_or("disclosure_invalid")?;
        if revealed.len() != expected.len() { return Err("excess_disclosure"); }
        for (row, index) in revealed.iter().zip(&expected) { exact_keys(row, &["index", "value"])?; if row["index"].as_u64() != Some(*index as u64) || row["value"] != messages[*index] { return Err("disclosure_binding_failed"); } }
        let statement = json!({"version":proof["version"],"token_id":proof["token_id"],"request":request,"proof":proof["proof"],"disclosed":proof["disclosed"]});
        check_signature(&statement, text(proof, "holder_signature")?, text(input, "owner_id")?)?;
        check_signature(payload, text(request, "signature")?, text(input, "request_public_key")?)?;
        let bbs = text(proof, "proof")?;
        if bbs.len() < 100 || bbs.len() > 5000 { return Err("proof_invalid"); }
    }
    Ok(())
}
pub fn encrypt_agent(proof: &Value, key: &str, grant: &str, job: &str, index: u64) -> Result<String> {
    let cipher = Aes256Gcm::new_from_slice(&key32(key)?).map_err(|_| "delivery_invalid")?;
    let mut nonce = [0u8; 12]; rand::thread_rng().fill_bytes(&mut nonce);
    let aad = format!("facet-agent-delivery-v1:{}:{}:{}", grant, job, index);
    let plaintext = canonical(proof)?;
    let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), Payload { msg: &plaintext, aad: aad.as_bytes() }).map_err(|_| "delivery_invalid")?;
    let mut bytes = vec![1]; bytes.extend_from_slice(&nonce); bytes.extend_from_slice(&encrypted); Ok(STANDARD.encode(bytes))
}
pub fn encrypt_owner(copy: &Value, recipient: &str, job: &str) -> Result<String> {
    let secret = StaticSecret::random_from_rng(rand::thread_rng());
    let public = PublicKey::from(&secret); let receiver = PublicKey::from(key32(recipient)?);
    let shared = secret.diffie_hellman(&receiver);
    if shared.as_bytes() == &[0; 32] { return Err("recipient_invalid"); }
    let mut key = [0; 32]; Hkdf::<Sha256>::new(None, shared.as_bytes()).expand(b"facet-owner-delivery-v1", &mut key).map_err(|_| "delivery_invalid")?;
    let mut nonce = [0; 12]; rand::thread_rng().fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "delivery_invalid")?;
    let plain = canonical(copy)?; let aad = format!("facet-owner-delivery-v1:{}", job);
    let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), Payload { msg: &plain, aad: aad.as_bytes() }).map_err(|_| "delivery_invalid")?;
    let mut bytes = vec![2]; bytes.extend_from_slice(public.as_bytes()); bytes.extend_from_slice(&nonce); bytes.extend_from_slice(&encrypted); Ok(STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Signer;
    #[test] fn field_sets_are_exact() { assert_eq!(mask(&json!(["course","achievement"])), Ok(3)); assert!(mask(&json!(["course","course"])).is_err()); assert!(mask(&json!(["password"])).is_err()); assert_eq!(indexes(3), vec![0,1,2,3,4,8,9]); }
    #[test] fn owner_approvals_bind_the_payload() { let key = SigningKey::from_bytes(&[7;32]); let v = json!({"audience":"agent.testnet","fields":["course"]}); let signature = STANDARD.encode(key.sign(&canonical(&v).unwrap()).to_bytes()); let owner = hex::encode(key.verifying_key().to_bytes()); assert!(check_signature(&v, &signature, &owner).is_ok()); assert!(check_signature(&json!({"audience":"other.testnet","fields":["course"]}), &signature, &owner).is_err()); }
    #[test] fn encrypted_delivery_is_bound_to_job_and_recipient() { let v = json!({"approved":"Completed"}); let key = "11".repeat(32); let wire = STANDARD.decode(encrypt_agent(&v, &key, "grant", "job", 0).unwrap()).unwrap(); let cipher = Aes256Gcm::new_from_slice(&key32(&key).unwrap()).unwrap(); assert!(cipher.decrypt(Nonce::from_slice(&wire[1..13]), Payload{msg:&wire[13..],aad:b"facet-agent-delivery-v1:grant:job:0"}).is_ok()); assert!(cipher.decrypt(Nonce::from_slice(&wire[1..13]), Payload{msg:&wire[13..],aad:b"facet-agent-delivery-v1:grant:other:0"}).is_err()); assert!(!String::from_utf8_lossy(&wire).contains("Completed")); }
}
