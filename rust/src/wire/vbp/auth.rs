//! VBP authentication: PLAIN (RFC 4616) and SCRAM-SHA-256 (RFC 5802 / RFC 7677).
//!
//! Two message-flow variants are supported:
//!
//! * PLAIN — a single AUTH_RESPONSE carrying `\0user\0pass` (RFC 4616).
//!   No challenge required.
//!
//! * SCRAM-SHA-256 — RFC 5802 4-message flow (client-first →
//!   server-first → client-final → server-final).
//!
//! PLAIN: 1 round trip.
//! SCRAM: 4-message flow using `hmac` + `sha2` + `base64` crates.
//!
//! **IMPORTANT (gotcha)**: the SCRAM `c=` channel-binding input is just
//! the GS2 header (e.g. `"n,,"`) for `gs2-flag == "n"`, NOT
//! `gs2_header + "," + client_first_bare` (that's a known bug in the
//! Python POC and the first Node POC submission). The RFC 5802 §6
//! pencil test vector is `c=biws` which is `base64("n,,")`. We use the
//! spec-correct form here.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};
use thiserror::Error;

use super::opcodes::{
    AUTH_MECH_NONE, AUTH_MECH_PLAIN, AUTH_MECH_SCRAM_SHA_256, OP_AUTH_CHALLENGE, OP_AUTH_OK,
    OP_AUTH_RESPONSE, SQLSTATE_AUTH_FAILED,
};
use super::multiplexer::Multiplexer;
use super::frame::Frame;

#[derive(Debug, Error)]
pub enum VBPAuthError {
    #[error("[{0}] {1}")]
    Failed(String, String),
}

// RFC 5802 §5.1: the GS2 header is "n,," for a client that does not
// support channel binding and has no authzid. We use that constant.
const SCRAM_GS2_HEADER: &str = "n,,";

// ────────────────────────────────────────────────────────────────────
// PLAIN
// ────────────────────────────────────────────────────────────────────

/// Build the PLAIN auth body per RFC 4616:
/// `[authzid] NUL authcid NUL password` (v1 has no authzid).
pub fn plain_client_first(username: &str, password: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(0u8); // empty authzid
    out.extend_from_slice(username.as_bytes());
    out.push(0u8);
    out.extend_from_slice(password.as_bytes());
    out
}

// ────────────────────────────────────────────────────────────────────
// SCRAM-SHA-256 (RFC 5802)
// ────────────────────────────────────────────────────────────────────

fn xor(a: &[u8], b: &[u8]) -> Vec<u8> {
    assert_eq!(a.len(), b.len(), "xor length mismatch");
    a.iter().zip(b.iter()).map(|(x, y)| x ^ y).collect()
}

fn hmac_sha256(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC accepts any key");
    mac.update(msg);
    mac.finalize().into_bytes().to_vec()
}

fn pbkdf2_sha256(password: &[u8], salt: &[u8], iters: u32) -> Vec<u8> {
    // Use a minimal PBKDF2-HMAC-SHA-256 implementation (RFC 2898).
    // We avoid pulling in the `pbkdf2` crate to keep deps small.
    pbkdf2_hmac_sha256(password, salt, iters, 32)
}

fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], iters: u32, dk_len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(dk_len);
    let blocks = (dk_len + 31) / 32;
    for i in 1..=blocks as u32 {
        let mut salt_block = salt.to_vec();
        salt_block.extend_from_slice(&i.to_be_bytes());
        let u1 = hmac_sha256(password, &salt_block);
        let mut u_prev = u1.clone();
        let mut t = u1.clone();
        for _ in 1..iters {
            let u_n = hmac_sha256(password, &u_prev);
            for j in 0..t.len() {
                t[j] ^= u_n[j];
            }
            u_prev = u_n;
        }
        out.extend_from_slice(&t);
    }
    out.truncate(dk_len);
    out
}

fn saslname(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '=' => "=3D".to_string(),
            ',' => "=2C".to_string(),
            other => other.to_string(),
        })
        .collect()
}

fn parse_server_first(server_first: &str) -> ServerFirstParts {
    let mut out = ServerFirstParts::default();
    for part in server_first.split(',') {
        if let Some(eq) = part.find('=') {
            let k = &part[..eq];
            let v = &part[eq + 1..];
            match k {
                "r" => out.r = v.to_string(),
                "s" => out.s = v.to_string(),
                "i" => {
                    out.i = v.parse::<u32>().unwrap_or(0);
                }
                _ => {}
            }
        }
    }
    out
}

#[derive(Default, Debug)]
struct ServerFirstParts {
    r: String,
    s: String,
    i: u32,
}

#[derive(Debug)]
pub struct SCRAMClient {
    username: String,
    password: String,
    client_nonce: String,
    combined_nonce: Option<String>,
    auth_message: Option<Vec<u8>>,
    client_proof: Option<Vec<u8>>,
    salt_b64: Option<String>,
    iters: u32,
}

impl SCRAMClient {
    pub fn new(username: &str, password: &str) -> Result<Self, VBPAuthError> {
        if username.is_empty() {
            return Err(VBPAuthError::Failed(
                SQLSTATE_AUTH_FAILED.into(),
                "empty username".into(),
            ));
        }
        // 18 random bytes -> 24 base64 chars
        let mut bytes = [0u8; 18];
        rand::thread_rng().fill_bytes(&mut bytes);
        let client_nonce = B64.encode(bytes);
        Ok(Self {
            username: username.to_string(),
            password: password.to_string(),
            client_nonce,
            combined_nonce: None,
            auth_message: None,
            client_proof: None,
            salt_b64: None,
            iters: 0,
        })
    }

    pub fn client_nonce(&self) -> &str {
        &self.client_nonce
    }

    /// client-first-bare (RFC 5802 §5.1): `n=user,r=client-nonce`.
    pub fn client_first_bare(&self) -> String {
        format!("n={},r={}", saslname(&self.username), self.client_nonce)
    }

    /// client-first (with GS2 header): `n,,<bare>`.
    pub fn client_first(&self) -> String {
        format!("{}{}", SCRAM_GS2_HEADER, self.client_first_bare())
    }

    /// client-final-message (with proof).
    pub fn client_final_message(&mut self, server_first_msg: &str) -> String {
        let parsed = parse_server_first(server_first_msg);
        let combined = parsed.r.clone();
        if !combined.starts_with(&self.client_nonce) {
            panic!(
                "[{}] server nonce does not begin with client nonce (possible MITM)",
                SQLSTATE_AUTH_FAILED
            );
        }
        self.combined_nonce = Some(combined.clone());
        let salt_b64 = parsed.s.clone();
        let iters = parsed.i;
        self.salt_b64 = Some(salt_b64.clone());
        self.iters = iters;

        let client_first_bare = self.client_first_bare();
        let gs2_header = SCRAM_GS2_HEADER;
        // Per RFC 5802 §6: for gs2-flag 'n' (no channel binding),
        // cbind-data is ABSENT, so cbind-input == gs2-header.
        // The pencil test vector is c=biws which is base64("n,,").
        let cbind_input = gs2_header.as_bytes();
        let channel_binding = B64.encode(cbind_input);
        let client_final_without_proof =
            format!("c={},r={}", channel_binding, combined);
        let server_first_recon = format!("r={},s={},i={}", combined, salt_b64, iters);
        let auth_message = format!(
            "{},{},{}",
            client_first_bare, server_first_recon, client_final_without_proof
        );
        let auth_message_bytes = auth_message.as_bytes().to_vec();
        self.auth_message = Some(auth_message_bytes.clone());

        let salt = B64.decode(&salt_b64).expect("valid base64 salt");
        let salted_password = pbkdf2_sha256(self.password.as_bytes(), &salt, iters);
        let client_key = hmac_sha256(&salted_password, b"Client Key");
        let stored_key = Sha256::digest(&client_key).to_vec();
        let client_signature = hmac_sha256(&stored_key, &auth_message_bytes);
        let client_proof = xor(&client_key, &client_signature);
        self.client_proof = Some(client_proof.clone());

        format!(
            "{},p={}",
            client_final_without_proof,
            B64.encode(&client_proof)
        )
    }

    /// Verify the server-final (RFC 5802 §6). v1 dev server may emit
    /// an empty body — in that case, treat as success.
    pub fn verify_server_final(&self, server_final_msg: &str) -> Result<(), VBPAuthError> {
        if server_final_msg.is_empty() {
            return Ok(());
        }
        if !server_final_msg.starts_with("v=") {
            return Err(VBPAuthError::Failed(
                SQLSTATE_AUTH_FAILED.into(),
                format!("server-final has no v= signature: {server_final_msg:?}"),
            ));
        }
        let server_sig = B64
            .decode(server_final_msg[2..].trim())
            .map_err(|e| VBPAuthError::Failed(SQLSTATE_AUTH_FAILED.into(), e.to_string()))?;
        let salt = B64
            .decode(self.salt_b64.as_deref().unwrap_or(""))
            .map_err(|e| VBPAuthError::Failed(SQLSTATE_AUTH_FAILED.into(), e.to_string()))?;
        let salted_password = pbkdf2_sha256(self.password.as_bytes(), &salt, self.iters);
        let server_key = hmac_sha256(&salted_password, b"Server Key");
        let expected_sig = hmac_sha256(
            &server_key,
            self.auth_message.as_deref().unwrap_or(&[]),
        );
        if server_sig != expected_sig {
            return Err(VBPAuthError::Failed(
                SQLSTATE_AUTH_FAILED.into(),
                "server signature mismatch — possible MITM".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct HandshakeResult {
    pub session_token: u64,
    pub expires_at: u64,
    pub server_final: Vec<u8>,
}

fn parse_auth_ok(replies: &[Frame]) -> Result<HandshakeResult, VBPAuthError> {
    for f in replies {
        if f.op == OP_AUTH_OK {
            let body = &f.body;
            if body.len() < 20 {
                return Err(VBPAuthError::Failed(
                    SQLSTATE_AUTH_FAILED.into(),
                    "AUTH_OK body too short".into(),
                ));
            }
            let mut a = [0u8; 8];
            a.copy_from_slice(&body[..8]);
            let session_token = u64::from_le_bytes(a);
            a.copy_from_slice(&body[8..16]);
            let expires_at = u64::from_le_bytes(a);
            let mut b = [0u8; 4];
            b.copy_from_slice(&body[16..20]);
            let sf_len = u32::from_le_bytes(b) as usize;
            let server_final = if body.len() >= 20 + sf_len {
                body[20..20 + sf_len].to_vec()
            } else {
                vec![]
            };
            return Ok(HandshakeResult {
                session_token,
                expires_at,
                server_final,
            });
        }
    }
    Err(VBPAuthError::Failed(
        SQLSTATE_AUTH_FAILED.into(),
        "no AUTH_OK in replies".into(),
    ))
}

#[derive(Debug, Clone, Default)]
pub struct HandshakeOptions<'a> {
    pub mechanism: &'a str,
    pub username: &'a str,
    pub password: &'a str,
    pub timeout: Option<std::time::Duration>,
}

pub async fn perform_handshake(
    mux: &Multiplexer,
    opts: HandshakeOptions<'_>,
) -> Result<HandshakeResult, VBPAuthError> {
    match opts.mechanism {
        AUTH_MECH_NONE => Ok(HandshakeResult {
            session_token: 0,
            expires_at: 0,
            server_final: vec![],
        }),
        AUTH_MECH_PLAIN => {
            let body = plain_client_first(opts.username, opts.password);
            let replies = mux
                .call(OP_AUTH_RESPONSE, body, opts.timeout)
                .await
                .map_err(|e| {
                    VBPAuthError::Failed(
                        SQLSTATE_AUTH_FAILED.into(),
                        format!("PLAIN auth send failed: {e}"),
                    )
                })?;
            parse_auth_ok(&replies)
        }
        AUTH_MECH_SCRAM_SHA_256 => {
            let mut scram =
                SCRAMClient::new(opts.username, opts.password).map_err(|e| match e {
                    VBPAuthError::Failed(s, m) => VBPAuthError::Failed(s, m),
                })?;
            let cf_full = scram.client_first();
            let replies1 = mux
                .call(OP_AUTH_RESPONSE, cf_full.into_bytes(), opts.timeout)
                .await
                .map_err(|e| {
                    VBPAuthError::Failed(
                        SQLSTATE_AUTH_FAILED.into(),
                        format!("SCRAM client-first send failed: {e}"),
                    )
                })?;
            // Find challenge or AUTH_OK (dev mode may skip).
            let mut challenge_body: Option<Vec<u8>> = None;
            for f in &replies1 {
                if f.op == OP_AUTH_CHALLENGE {
                    challenge_body = Some(f.body.clone());
                    break;
                }
                if f.op == OP_AUTH_OK {
                    return parse_auth_ok(&replies1);
                }
            }
            let challenge_body = challenge_body.ok_or_else(|| {
                VBPAuthError::Failed(
                    SQLSTATE_AUTH_FAILED.into(),
                    "no AUTH_CHALLENGE from server".into(),
                )
            })?;
            let server_first_msg = String::from_utf8_lossy(&challenge_body).to_string();
            let client_final = scram.client_final_message(&server_first_msg);
            let replies2 = mux
                .call(OP_AUTH_RESPONSE, client_final.into_bytes(), opts.timeout)
                .await
                .map_err(|e| {
                    VBPAuthError::Failed(
                        SQLSTATE_AUTH_FAILED.into(),
                        format!("SCRAM client-final send failed: {e}"),
                    )
                })?;
            let result = parse_auth_ok(&replies2)?;
            if !result.server_final.is_empty() {
                let s = String::from_utf8_lossy(&result.server_final).to_string();
                scram
                    .verify_server_final(&s)
                    .map_err(|e| match e {
                        VBPAuthError::Failed(s, m) => VBPAuthError::Failed(s, m),
                    })?;
            }
            Ok(result)
        }
        _ => Err(VBPAuthError::Failed(
            "0A000".into(),
            format!("unsupported auth mechanism: {}", opts.mechanism),
        )),
    }
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_client_first_format() {
        let body = plain_client_first("alice", "secret");
        // \0alice\0secret
        assert_eq!(body, b"\x00alice\x00secret");
    }

    #[test]
    fn plain_client_first_empty_password() {
        let body = plain_client_first("user", "");
        assert_eq!(body, b"\x00user\x00");
    }

    #[test]
    fn plain_client_first_utf8() {
        let body = plain_client_first("user", "pässwörd");
        let expected = b"\x00user\x00p\xc3\xa4ssw\xc3\xb6rd".to_vec();
        assert_eq!(body, expected);
    }

    #[test]
    fn saslname_escapes_equal_and_comma() {
        assert_eq!(saslname("a=b"), "a=3Db");
        assert_eq!(saslname("a,b"), "a=2Cb");
        assert_eq!(saslname("normal"), "normal");
    }

    #[test]
    fn parse_server_first_extracts_r_s_i() {
        let p = parse_server_first("r=client-nonce-server-nonce,s=c2FsdA==,i=4096");
        assert_eq!(p.r, "client-nonce-server-nonce");
        assert_eq!(p.s, "c2FsdA==");
        assert_eq!(p.i, 4096);
    }

    #[test]
    fn xor_round_trip() {
        let a = vec![1u8, 2, 3, 4];
        let b = vec![5u8, 6, 7, 8];
        let c = xor(&a, &b);
        let a2 = xor(&c, &b);
        assert_eq!(a, a2);
    }

    #[test]
    fn hmac_sha256_known_vector() {
        // RFC 4231 test case 1: key = 0x0b * 20, msg = "Hi There"
        let key = vec![0x0b; 20];
        let out = hmac_sha256(&key, b"Hi There");
        let expected = hex_decode(
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
        );
        assert_eq!(out, expected);
    }

    #[test]
    fn pbkdf2_sha256_known_vector() {
        // RFC 7914 §11 test vector for PBKDF2-HMAC-SHA-256
        // P = "passwd", S = "salt", c = 1, dkLen = 32
        let out = pbkdf2_sha256(b"passwd", b"salt", 1);
        let expected = hex_decode(
            "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc",
        );
        assert_eq!(out, expected);
    }

    #[test]
    fn pbkdf2_sha256_4096_iterations() {
        // RFC 7914 §11: P = "Password", S = "NaCl", c = 80000, dkLen = 32
        // We use a smaller test: P = "password", S = "salt", c = 4096, dkLen = 20
        let out = pbkdf2_sha256(b"password", b"salt", 4096);
        // Truncate to 20 bytes for comparison.
        let truncated = &out[..20];
        let expected = hex_decode("4b007901b765489abead49d926f721d065a429c1");
        assert_eq!(truncated, expected);
    }

    #[test]
    fn scram_client_first_bare() {
        let c = SCRAMClient::new("user", "password").unwrap();
        let bare = c.client_first_bare();
        assert!(bare.starts_with("n=user,r="));
        assert_eq!(bare.len(), "n=user,r=".len() + 24);
    }

    #[test]
    fn scram_client_first_full() {
        let c = SCRAMClient::new("user", "password").unwrap();
        let full = c.client_first();
        assert!(full.starts_with("n,,n=user,r="));
    }

    #[test]
    fn scram_client_final_uses_biws_channel_binding() {
        let mut c = SCRAMClient::new("user", "password").unwrap();
        // fake server-first with matching nonce
        let server_first = format!("r={},s=c2FsdA==,i=1", c.client_nonce());
        let final_msg = c.client_final_message(&server_first);
        // c=biws is base64("n,,") per RFC 5802 §6 pencil test vector
        assert!(final_msg.starts_with("c=biws,r="));
        assert!(final_msg.contains(",p="));
    }

    #[test]
    fn scram_client_final_rejects_mismatched_nonce() {
        let mut c = SCRAMClient::new("user", "password").unwrap();
        // server-first with a different nonce
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.client_final_message("r=DIFFERENT_NONCE,s=c2FsdA==,i=1");
        }));
        assert!(result.is_err(), "expected panic on nonce mismatch");
    }

    #[test]
    fn scram_verify_server_final_empty_is_ok() {
        let c = SCRAMClient::new("user", "password").unwrap();
        c.verify_server_final("").unwrap();
    }

    #[test]
    fn scram_verify_server_final_bad_signature() {
        let c = SCRAMClient::new("user", "password").unwrap();
        let result = c.verify_server_final("v=bogus");
        assert!(result.is_err());
    }

    #[test]
    fn scram_client_nonce_length() {
        let c = SCRAMClient::new("u", "p").unwrap();
        // 18 random bytes -> 24 base64 chars
        assert_eq!(c.client_nonce().len(), 24);
    }

    #[test]
    fn empty_username_rejected() {
        let result = SCRAMClient::new("", "p");
        assert!(result.is_err());
    }

    fn hex_decode(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }
}
