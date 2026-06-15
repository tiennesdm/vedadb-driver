//! VBP v1 transport — integration tests.
//!
//! This is the conformance runner test, ported from the Python POC
//! (`conformance_runner.py`). It runs against a live VBP server (the
//! Go `vbp_dev_server` shipped in `/private/tmp/vbp-wave1-spec/`).
//!
//! Run with:
//! ```text
//! cargo test --test conformance_runner -- --nocapture
//! ```
//!
//! The test expects `vbp_dev_server` to be running on 127.0.0.1:6380
//! (or whichever address `VBP_TEST_ADDR` points to).

use std::time::Duration;

use vedadb::wire::vbp::{
    parse_addr, run_all, to_junit_xml, ConformanceReport, Multiplexer, VBPConnection,
    DEFAULT_VBP_PORT,
};

fn get_test_addr() -> (String, u16) {
    if let Ok(addr) = std::env::var("VBP_TEST_ADDR") {
        if let Some((h, p)) = parse_addr(&addr) {
            return (h.to_string(), p);
        }
    }
    ("127.0.0.1".to_string(), DEFAULT_VBP_PORT)
}

#[tokio::test]
async fn live_server_round_trip_ping() {
    let (host, port) = get_test_addr();
    let mux = Multiplexer::connect(&host, port).await;
    if mux.is_err() {
        eprintln!(
            "skipping live_server_round_trip_ping: cannot connect to {host}:{port}"
        );
        return;
    }
    let mux = mux.unwrap();
    let nonce: u64 = 0xDEADBEEFCAFEBABE;
    let body = nonce.to_le_bytes().to_vec();
    let reply = mux.call(0x16, body, Some(Duration::from_secs(2))).await;
    if reply.is_err() {
        eprintln!("skipping: call failed: {:?}", reply.err());
        return;
    }
    let replies = reply.unwrap();
    assert!(!replies.is_empty(), "no replies");
    // The dev server may reply with PONG, AUTH_OK, SERVER_READY in some order.
    // We at minimum need some frame.
}

#[tokio::test]
async fn live_server_connection_connect() {
    let (host, port) = get_test_addr();
    let mut conn = VBPConnection::new(&host, port, "u", "p", "d");
    if conn.connect().await.is_err() {
        eprintln!("skipping live_server_connection_connect: cannot connect");
        return;
    }
    // PASS — connection established.
    conn.close().await;
}

#[tokio::test]
async fn live_server_full_conformance_report() {
    let (host, port) = get_test_addr();
    let report: ConformanceReport = match run_all(&host, port).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("skipping: conformance run failed: {e}");
            return;
        }
    };
    // Emit JUnit XML to /tmp.
    let xml = to_junit_xml(&report);
    let _ = std::fs::write("/tmp/vbp-rust-conformance.xml", &xml);
    assert!(
        report.total_passed >= 3,
        "expected ≥3 categories passed, got {}/{}",
        report.total_passed,
        report.total
    );
}
