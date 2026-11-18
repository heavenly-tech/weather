//! Desk-route goldens. Recorded AWC and Open-Meteo bodies, no live network.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde::Deserialize;
use tower::ServiceExt;

use crate::cache::{Clock, FetchFn, UpstreamResponse};
use crate::state::{AppState, BytesResponse};
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
    #[serde(rename = "contentType")]
    content_type: Option<String>,
    #[serde(rename = "cacheControl")]
    cache_control: Option<String>,
}

#[tokio::test]
async fn desk_routes_match_typescript_bytes() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/desk");
    let recorded = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/recorded");
    let manifest: Vec<Case> =
        serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
    assert!(manifest
        .iter()
        .any(|case| case.role.as_deref() == Some("night") && case.label == "recorded"));
    assert!(manifest
        .iter()
        .any(|case| case.role.as_deref() == Some("missing-field") && case.label == "recorded"));
    assert!(manifest.iter().any(|case| case.label == "EXAMPLE"));
    let gfs = std::fs::read_to_string(recorded.join("sctb-gfs-seamless-2026-11-18.json")).unwrap();
    let live_metar =
        std::fs::read_to_string(recorded.join("awc/metar-sctb-scel-2026-11-18.json")).unwrap();
    let night_metar =
        std::fs::read_to_string(recorded.join("awc/metar-scel-night-2026-11-17.json")).unwrap();
    let cavok_metar =
        std::fs::read_to_string(recorded.join("awc/metar-scel-cavok-2026-11-15.json")).unwrap();
    let live_taf =
        std::fs::read_to_string(recorded.join("awc/taf-sctb-scel-2026-11-18.json")).unwrap();
    let empty_taf = std::fs::read_to_string(recorded.join("awc/taf-sctb-2026-11-18.json")).unwrap();
    let sigmet = std::fs::read_to_string(recorded.join("awc/sigmet-2026-11-18.json")).unwrap();
    let gif = std::fs::read(recorded.join("awc/sam-12.gif")).unwrap();
    for case in &manifest {
        let clock_ms = parse_utc_iso(&case.clock).unwrap().epoch_ms();
        let mut state = AppState::for_tests(
            scripted(
                &case.upstream,
                Recorded {
                    gfs: gfs.clone(),
                    live_metar: live_metar.clone(),
                    night_metar: night_metar.clone(),
                    cavok_metar: cavok_metar.clone(),
                    live_taf: live_taf.clone(),
                    empty_taf: empty_taf.clone(),
                    sigmet: sigmet.clone(),
                },
            ),
            Clock::at(clock_ms),
            Arc::new(|| 0.5),
        );
        if case.id == "synoptic-image" {
            let bytes = gif.clone();
            state.binary = Arc::new(move |_| {
                let bytes = bytes.clone();
                Box::pin(async move {
                    Ok(BytesResponse {
                        status: 200,
                        body: bytes,
                        status_text: "OK".to_string(),
                        content_type: "image/gif".to_string(),
                    })
                })
            });
        }
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
        let content_type = response
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let cache_control = response
            .headers()
            .get(axum::http::header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(
            status,
            StatusCode::from_u16(case.status).unwrap(),
            "{}",
            case.id
        );
        assert_eq!(content_type, case.content_type, "{}", case.id);
        assert_eq!(cache_control, case.cache_control, "{}", case.id);
        let expected = std::fs::read(root.join(format!("{}.body", case.id))).unwrap();
        if bytes.as_ref() != expected.as_slice() {
            let got = String::from_utf8_lossy(&bytes);
            let want = String::from_utf8_lossy(&expected);
            panic!("{} differs at {}", case.id, first_diff(&got, &want));
        }
    }
}

fn first_diff(got: &str, want: &str) -> String {
    let got_b = got.as_bytes();
    let want_b = want.as_bytes();
    let limit = got_b.len().min(want_b.len());
    let mut index = 0;
    while index < limit && got_b[index] == want_b[index] {
        index += 1;
    }
    let start = index.saturating_sub(60);
    let end = (index + 80).min(got.len().max(want.len()));
    format!(
        "byte {index} len {} vs {}\n got {}\n want {}",
        got.len(),
        want.len(),
        got.get(start..end.min(got.len())).unwrap_or(""),
        want.get(start..end.min(want.len())).unwrap_or("")
    )
}

struct Recorded {
    gfs: String,
    live_metar: String,
    night_metar: String,
    cavok_metar: String,
    live_taf: String,
    empty_taf: String,
    sigmet: String,
}

fn scripted(kind: &str, recorded: Recorded) -> FetchFn {
    let kind = kind.to_string();
    Arc::new(move |url: String| {
        let kind = kind.clone();
        let recorded = Recorded {
            gfs: recorded.gfs.clone(),
            live_metar: recorded.live_metar.clone(),
            night_metar: recorded.night_metar.clone(),
            cavok_metar: recorded.cavok_metar.clone(),
            live_taf: recorded.live_taf.clone(),
            empty_taf: recorded.empty_taf.clone(),
            sigmet: recorded.sigmet.clone(),
        };
        Box::pin(async move { Ok(hit(&kind, &url, &recorded)) })
    })
}

fn hit(kind: &str, url: &str, recorded: &Recorded) -> UpstreamResponse {
    if kind == "down" {
        return response(502, "upstream", "Bad Gateway");
    }
    if url.contains("climatologia.meteochile.gob.cl") {
        return response(404, "no token", "Not Found");
    }
    if url.contains("/api/data/isigmet") {
        return response(200, &recorded.sigmet, "OK");
    }
    if url.contains("/api/data/metar") {
        return response(
            200,
            &metar_body(
                kind,
                url,
                &recorded.live_metar,
                &recorded.night_metar,
                &recorded.cavok_metar,
            ),
            "OK",
        );
    }
    if url.contains("/api/data/taf") {
        let ids = query(url, "ids");
        let body = if ids == "SCTB" || (kind == "missing" && ids.contains("SCTB")) {
            recorded.empty_taf.as_str()
        } else {
            recorded.live_taf.as_str()
        };
        return response(200, body, "OK");
    }
    if url.contains("api.open-meteo.com") {
        return response(200, &replay(&recorded.gfs, url), "OK");
    }
    response(502, "no recording", "Bad Gateway")
}

fn metar_body(kind: &str, url: &str, live: &str, night: &str, cavok: &str) -> String {
    let ids = query(url, "ids");
    if kind == "missing" {
        return if ids.contains("SCTB") && !ids.contains(',') {
            "[]".to_string()
        } else {
            cavok.to_string()
        };
    }
    if kind == "night-archive" {
        return night.to_string();
    }
    let wanted: Vec<&str> = ids.split(',').filter(|part| !part.is_empty()).collect();
    let rows: Vec<serde_json::Value> = serde_json::from_str(live).unwrap();
    let kept: Vec<&serde_json::Value> = rows
        .iter()
        .filter(|row| {
            row.get("icaoId")
                .and_then(|value| value.as_str())
                .is_some_and(|icao| wanted.contains(&icao))
        })
        .collect();
    serde_json::to_string(&kept).unwrap_or_else(|_| live.to_string())
}

fn replay(raw: &str, url: &str) -> String {
    let count = query(url, "latitude")
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

#[tokio::test]
async fn invalid_open_meteo_json_is_502_json() {
    let fetch: FetchFn = Arc::new(|url: String| {
        Box::pin(async move {
            if url.contains("api.open-meteo.com") {
                Ok(UpstreamResponse {
                    status: 200,
                    body: "not-json".to_string(),
                    status_text: "OK".to_string(),
                })
            } else {
                Ok(UpstreamResponse {
                    status: 404,
                    body: "no token".to_string(),
                    status_text: "Not Found".to_string(),
                })
            }
        })
    });
    let state = AppState::for_tests(fetch, Clock::at(0), Arc::new(|| 0.5));
    let dist = tempfile::tempdir().unwrap();
    let response = crate::app::router_with(dist.path().to_path_buf(), state)
        .oneshot(
            Request::builder()
                .uri("/api/forecast?icao=SCTB")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(
        response
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("application/json")
    );
    assert!(response
        .headers()
        .get(axum::http::header::CACHE_CONTROL)
        .is_none());
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    assert_eq!(text, "{\"error\":\"expected ident at line 1 column 2\"}");
}

#[tokio::test]
async fn invalid_awc_json_stays_on_the_mock_envelope() {
    let fetch: FetchFn = Arc::new(|_: String| {
        Box::pin(async move {
            Ok(UpstreamResponse {
                status: 200,
                body: "not-json".to_string(),
                status_text: "OK".to_string(),
            })
        })
    });
    let state = AppState::for_tests(fetch, Clock::at(0), Arc::new(|| 0.5));
    let dist = tempfile::tempdir().unwrap();
    let response = crate::app::router_with(dist.path().to_path_buf(), state)
        .oneshot(
            Request::builder()
                .uri("/api/metar?icao=SCEL")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(text.contains("\"source\":\"mock\""));
    assert!(text.contains("expected ident at line 1 column 2"), "{text}");
}
