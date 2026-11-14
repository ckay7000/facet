#[cfg(target_os = "wasi")]
use facet_private_vault::*;
#[cfg(target_os = "wasi")]
use serde_json::{json, Value};
#[cfg(target_os = "wasi")]
use outlayer::{env, storage::sealed};

#[cfg(target_os = "wasi")]
#[used]
#[link_section = "outlayer.manifest"]
static MANIFEST: [u8; include_bytes!("../manifest.json").len()] = *include_bytes!("../manifest.json");

#[cfg(target_os = "wasi")]
fn run() -> Result<Value> {
    let input: Value = env::input_json().map_err(|_| "input_invalid")?.ok_or("input_invalid")?;
    let contract = text(&input, "facet_contract_id")?;
    if !["credentials.facet-lab-1102.testnet", "facet-checks-1102.testnet"].contains(&contract) || env::predecessor_account_id().as_deref() != Some(contract) { return Err("caller_refused"); }
    if input["schema"] != "facet-tee-input-v1" { return Err("input_invalid"); }
    let owner = text(&input, "owner_id")?; let token = text(&input, "token_id")?; let job = text(&input, "job_id")?; let operation = text(&input, "operation")?;
    if key32(owner).is_err() || !token.starts_with("facet_") || token.len() != 38 || job.len() != 32 { return Err("input_invalid"); }
    // Current workers publish NEAR_REQUEST_ID. SDK 0.2.1 still reads the
    // older OUTLAYER_REQUEST_ID alias, so prefer the protected current name.
    let request_id = std::env::var("NEAR_REQUEST_ID").ok().filter(|id| !id.is_empty()).or_else(env::request_id);
    let mut output = json!({"schema":"facet-tee-output-v1","operation":operation,"job_id":job,"outlayer_request_id":request_id,"transaction_hash":env::transaction_hash()});
    let name = |hash: &str| format!("facet-copy-v1:{}:{}:{}", owner, token, hash);
    if operation == "store_copy" || operation == "store_grant" {
        let private = std::env::var("FACET_PACKET").map_err(|_| "private_input_missing")?;
        let packet: Value = serde_json::from_str(&private).map_err(|_| "packet_invalid")?;
        let bytes = canonical(&packet)?;
        if bytes.len() > 250000 || digest(&bytes) != text(&input, "packet_hash")? { return Err("packet_commitment_failed"); }
        let storage_name;
        if operation == "store_copy" { validate_copy(&packet, &input)?; storage_name = name(text(&input, "packet_hash")?); }
        else {
            let copy_record = sealed::get("credentials", None, &name(text(&input["grant"], "copy_hash")?)).map_err(|_| "storage_unavailable")?.ok_or("private_copy_missing")?;
            let copy: Value = serde_json::from_slice(copy_record.plaintext()).map_err(|_| "copy_invalid")?;
            validate_grant(&packet, &input, &copy)?;
            storage_name = format!("facet-grant-v1:{}:{}", owner, text(&input["grant"], "id")?);
        }
        if !sealed::set_if_absent("credentials", None, &storage_name, &bytes).map_err(|_| "storage_unavailable")? {
            let prior = sealed::get("credentials", None, &storage_name).map_err(|_| "storage_unavailable")?.ok_or("storage_unavailable")?;
            if prior.plaintext() != bytes { return Err("stored_data_conflict"); }
        }
        output["stored"] = json!(true); output["packet_hash"] = input["packet_hash"].clone();
    } else if operation == "use" {
        let grant = &input["grant"];
        if env::signer_account_id().as_deref() != grant["agent_id"].as_str() || grant["ready"] != true || grant["revoked"] != false || input["record"]["revoked"] != false || input["record"]["kind"] != "demo_issued" { return Err("permission_refused"); }
        let current = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "clock_unavailable")?.as_millis() as u64;
        if current >= grant["expires_at"].as_u64().ok_or("grant_invalid")? || current >= input["record"]["expires_at"].as_u64().ok_or("credential_invalid")? { return Err("permission_expired"); }
        let grant_id = text(grant, "id")?; let index = input["usage_index"].as_u64().ok_or("usage_invalid")?;
        if index >= grant["max_uses"].as_u64().ok_or("grant_invalid")? { return Err("permission_exhausted"); }
        let saved = sealed::get("credentials", None, &format!("facet-grant-v1:{}:{}", owner, grant_id)).map_err(|_| "storage_unavailable")?.ok_or("grant_missing")?;
        let packet: Value = serde_json::from_slice(saved.plaintext()).map_err(|_| "grant_invalid")?;
        let saved_copy = sealed::get("credentials", None, &name(text(grant, "copy_hash")?)).map_err(|_| "storage_unavailable")?.ok_or("private_copy_missing")?;
        let copy: Value = serde_json::from_slice(saved_copy.plaintext()).map_err(|_| "copy_invalid")?;
        validate_grant(&packet, &input, &copy)?;
        let spent = format!("facet-used-v1:{}:{}:{}", owner, grant_id, index);
        if !sealed::set_if_absent("credentials", None, &spent, job.as_bytes()).map_err(|_| "storage_unavailable")? { return Err("permission_use_replayed"); }
        let proof = &packet["presentations"][index as usize];
        output["ciphertext"] = json!(encrypt_agent(proof, text(&packet, "delivery_key")?, grant_id, job, index)?);
        output["grant_id"] = json!(grant_id); output["usage_index"] = json!(index);
    } else if operation == "recover" {
        if env::signer_account_id().as_deref() != input["wallet_id"].as_str() { return Err("owner_wallet_refused"); }
        let saved = sealed::get("credentials", None, &name(text(&input, "packet_hash")?)).map_err(|_| "storage_unavailable")?.ok_or("private_copy_missing")?;
        let copy: Value = serde_json::from_slice(saved.plaintext()).map_err(|_| "copy_invalid")?;
        validate_copy(&copy, &input)?;
        output["ciphertext"] = json!(encrypt_owner(&copy, text(&input, "recipient_public_key")?, job)?);
    } else { return Err("operation_refused"); }
    Ok(output)
}
fn main() {
    #[cfg(target_os = "wasi")]
    { let output = run().unwrap_or_else(|code| json!({"schema":"facet-tee-error-v1","code":code})); let _ = env::output_json(&output); }
    #[cfg(not(target_os = "wasi"))]
    { eprintln!("Facet's confidential worker runs as a WASI Preview 2 component; use cargo test for local checks."); }
}
