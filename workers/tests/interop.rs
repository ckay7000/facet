use facet_private_vault::*;
use serde_json::{json, Value};
use std::{env, fs};

fn fixture() -> Value { serde_json::from_slice(&fs::read(env::var("FACET_INTEROP_FIXTURE").expect("Run npm run test:worker")).unwrap()).unwrap() }

#[test]
#[ignore = "The Node harness creates real BBS presentations and checks encrypted outputs"]
fn javascript_copy_and_grants_have_exact_bindings() {
    let f = fixture(); let copy = &f["copy"]; let packet = &f["packet"]; let input = &f["input"];
    assert!(validate_copy(copy, input).is_ok(), "Genuine private copy must validate");
    assert!(validate_grant(packet, input, copy).is_ok(), "Real BBS presentations must pass scope and signature validation");
    let mut changed = copy.clone(); changed["document"]["data"] = json!("dGFtcGVyZWQ="); assert!(validate_copy(&changed, input).is_err());
    let mut changed = input.clone(); changed["owner_id"] = json!("11".repeat(32)); assert!(validate_copy(copy, &changed).is_err());
    let mut changed = packet.clone(); changed["delivery_key"] = json!("22".repeat(32)); assert!(validate_grant(&changed, input, copy).is_err());
    let mut changed = packet.clone(); changed["presentations"][0]["original_document"] = json!("UNAPPROVED"); assert!(validate_grant(&changed, input, copy).is_err());
    let mut changed = packet.clone(); changed["presentations"][0]["disclosed"].as_array_mut().unwrap().push(json!({"index":5,"value":"UNAPPROVED"})); assert!(validate_grant(&changed, input, copy).is_err());
    let mut changed = packet.clone(); changed["presentations"][0]["request"]["payload"]["purpose"] = json!("Different purpose"); assert!(validate_grant(&changed, input, copy).is_err());
    let mut changed = packet.clone(); changed["presentations"][0]["request"]["payload"]["audience"] = json!("other.testnet"); assert!(validate_grant(&changed, input, copy).is_err());
    let mut changed = packet.clone(); changed["presentations"][0] = changed["presentations"][1].clone(); assert!(validate_grant(&changed, input, copy).is_err());
    let mut changed = input.clone(); changed["grant"]["fields_mask"] = json!(63); assert!(validate_grant(packet, &changed, copy).is_err());
    let mut changed = copy.clone(); changed["document"]["salt"] = json!("00".repeat(32)); assert!(validate_grant(packet, input, &changed).is_err());
    println!("Verified genuine JS packets and 10 refused binding/disclosure mutations");
}

#[test]
#[ignore = "The Node harness independently decrypts the Rust worker envelopes"]
fn encrypted_worker_delivery_is_compatible_with_browser_crypto() {
    let f = fixture();
    let agent = encrypt_agent(&f["packet"]["presentations"][0], text(&f["packet"], "delivery_key").unwrap(), text(&f["input"]["grant"], "id").unwrap(), text(&f, "job_id").unwrap(), 0).unwrap();
    let owner = encrypt_owner(&f["copy"], text(&f, "recipient_public_key").unwrap(), text(&f, "job_id").unwrap()).unwrap();
    let out = json!({"agent":agent,"owner":owner});
    fs::write(env::var("FACET_INTEROP_OUTPUT").unwrap(), canonical(&out).unwrap()).unwrap();
}
