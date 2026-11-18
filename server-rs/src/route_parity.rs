//! Route goldens. The TypeScript handlers and these tests share a scripted
//! upstream that replays the recorded SCTB bodies. No live network.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde::Deserialize;
use tower::ServiceExt;

use crate::cache::{Clock, FetchFn, UpstreamResponse};
use crate::product_log::new_log_id;
use crate::state::AppState;
use crate::utc::parse_utc_iso;

#[derive(Deserialize)]
struct Case {
    id: String,
    path: String,
    status: u16,
    clock: String,
    upstream: String,
    label: String,
    #[serde(default)]
    role: Option<String>,
}

#[tokio::test]
async fn routes_match_typescript_bytes() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/routes");
    let manifest: Vec<Case> =
        serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert!(manifest
        .iter()
        .any(|case| case.role.as_deref() == Some("night") && case.label == "recorded"));
    assert!(manifest
        .iter()
        .any(|case| case.role.as_deref() == Some("missing-field") && case.label == "recorded"));
    assert!(manifest.iter().any(|case| case.upstream == "429"));
    assert!(manifest.iter().any(|case| case.upstream == "503"));
    let ecmwf = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/recorded/sctb-ecmwf-ifs025-2026-11-18.json"),
    )
    .unwrap();
    let gfs = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/recorded/sctb-gfs-seamless-2026-11-18.json"),
    )
    .unwrap();
    for case in &manifest {
        let clock_ms = parse_utc_iso(&case.clock).unwrap().epoch_ms();
        assert_eq!(
            new_log_id(clock_ms, 0.5),
            format!("{}-i", base36(clock_ms)),
            "log id stays on the JS half"
        );
        let state = AppState::for_tests(
            scripted(&case.upstream, ecmwf.clone(), gfs.clone()),
            Clock::at(clock_ms),
            Arc::new(|| 0.5),
        );
        let dist = tempfile::tempdir().unwrap();
        let response = crate::app::router_with(dist.path().to_path_buf(), state)
            .oneshot(
                Request::builder()
                    .uri(&case.path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        assert_eq!(
            response
                .headers()
                .get(axum::http::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/json"),
            "{}",
            case.id
        );
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let expected = std::fs::read(root.join(format!("{}.body", case.id))).unwrap();
        assert_eq!(
            status,
            StatusCode::from_u16(case.status).unwrap(),
            "{}",
            case.id
        );
        if bytes.as_ref() != expected.as_slice() {
            let got = String::from_utf8_lossy(&bytes);
            let want = String::from_utf8_lossy(&expected);
            let window = first_diff(&got, &want);
            panic!("{} differs at {window}", case.id);
        }
    }
}

fn base36(value: i64) -> String {
    crate::product_log::new_log_id(value, 0.5)
        .trim_end_matches("-i")
        .to_string()
}

fn first_diff(got: &str, want: &str) -> String {
    let limit = got.len().min(want.len());
    let mut index = 0;
    let got_b = got.as_bytes();
    let want_b = want.as_bytes();
    while index < limit && got_b[index] == want_b[index] {
        index += 1;
    }
    let start = index.saturating_sub(80);
    let end = (index + 80)
        .min(got.len())
        .min(want.len().saturating_add(80));
    format!(
        "byte {index}\n got {}\n want {}",
        got.get(start..end.min(got.len())).unwrap_or(""),
        want.get(start..end.min(want.len())).unwrap_or("")
    )
}

#[tokio::test]
async fn unknown_model_on_times_is_400_invalid_model() {
    let state = AppState::for_tests(failing("unused"), Clock::at(0), Arc::new(|| 0.5));
    let (status, body) = call(&state, "/api/andes/times?model=not_a_model").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body, br#"{"error":"Invalid model"}"#);
}

#[tokio::test]
async fn generated_transport_failure_is_502_json() {
    let state = AppState::for_tests(failing("connection reset"), Clock::at(0), Arc::new(|| 0.5));
    for path in [
        "/api/generated/metar?icao=SCTB&model=gfs_seamless",
        "/api/generated/taf?icao=SCTB&model=gfs_seamless",
    ] {
        let (status, body) = call(&state, path).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY, "{path}");
        assert_eq!(
            body, br#"{"error":"Upstream unavailable","code":"transport"}"#,
            "{path}"
        );
    }
}

async fn call(state: &AppState, path: &str) -> (StatusCode, Vec<u8>) {
    let dist = tempfile::tempdir().unwrap();
    let response = crate::app::router_with(dist.path().to_path_buf(), state.clone())
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, bytes.to_vec())
}

fn failing(message: &str) -> FetchFn {
    let message = message.to_string();
    Arc::new(move |_| {
        let message = message.clone();
        Box::pin(async move { Err(message) })
    })
}

fn scripted(kind: &str, ecmwf: String, gfs: String) -> FetchFn {
    let kind = kind.to_string();
    Arc::new(move |url: String| {
        let kind = kind.clone();
        let ecmwf = ecmwf.clone();
        let gfs = gfs.clone();
        Box::pin(async move { Ok(respond(&kind, &url, &ecmwf, &gfs)) })
    })
}

fn respond(kind: &str, url: &str, ecmwf: &str, gfs: &str) -> UpstreamResponse {
    if url.contains("aviationweather.gov") {
        return response(502, "upstream", "Bad Gateway");
    }
    if kind == "429" {
        return response(429, "", "Too Many Requests");
    }
    if kind == "503" {
        return response(503, "", "Service Unavailable");
    }
    if kind == "ceiling-429" {
        return response(429, "slow down", "Too Many Requests");
    }
    if kind == "ceiling-500" {
        return response(500, "boom", "Internal Server Error");
    }
    let model = query(url, "models");
    if model.starts_with("ecmwf_ifs025") {
        return response(200, &replay(ecmwf, url), "OK");
    }
    if model.starts_with("gfs_seamless") {
        return response(200, &replay(gfs, url), "OK");
    }
    response(502, "no recording", "Bad Gateway")
}

fn replay(raw: &str, url: &str) -> String {
    let lats = query(url, "latitude");
    let count = lats
        .split(',')
        .filter(|part| !part.is_empty())
        .count()
        .max(1);
    if count <= 1 {
        return raw.to_string();
    }
    let mut out = String::from("[");
    for index in 0..count {
        if index > 0 {
            out.push(',');
        }
        out.push_str(raw);
    }
    out.push(']');
    out
}

fn response(status: u16, body: &str, status_text: &str) -> UpstreamResponse {
    UpstreamResponse {
        status,
        body: body.to_string(),
        status_text: status_text.to_string(),
    }
}

fn query(url: &str, name: &str) -> String {
    let Some(query) = url.split_once('?').map(|(_, query)| query) else {
        return String::new();
    };
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if decode(key) == name {
            return decode(value);
        }
    }
    String::new()
}

fn decode(value: &str) -> String {
    let plus = value.replace('+', " ");
    let bytes = plus.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&plus[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
