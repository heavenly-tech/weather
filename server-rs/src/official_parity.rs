//! `/api/official/*` route tests with recorded IFIS HTML fixtures.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use tower::ServiceExt;

use crate::app::router_with;
use crate::cache::{Clock, FetchFn, UpstreamResponse};
use crate::state::AppState;
use crate::utc::parse_utc_iso;

fn ifis_fetch() -> FetchFn {
    let metar = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/official/metar-sctb.html"),
    )
    .unwrap();
    let taf = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/official/taf-sctb.html"),
    )
    .unwrap();
    let no_taf = std::fs::read_to_string(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/official/taf-scvh-none.html"),
    )
    .unwrap();
    Arc::new(move |url: String| {
        let body = if url.contains("/metar") {
            metar.clone()
        } else if url.contains("SCVH") {
            no_taf.clone()
        } else if url.contains("/taf") {
            taf.clone()
        } else {
            String::new()
        };
        Box::pin(async move {
            Ok(UpstreamResponse {
                status: 200,
                body,
                status_text: "OK".to_string(),
            })
        })
    })
}

#[tokio::test]
async fn official_metar_route_json() {
    let clock = Clock::at(parse_utc_iso("2026-11-18T13:05:00Z").unwrap().epoch_ms());
    let state = AppState::for_tests(ifis_fetch(), clock, Arc::new(|| 0.5));
    let app = router_with(tempdir_dist(), state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/official/metar?icao=SCTB")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(text.contains("\"officialLabel\":\"Oficial DGAC\""));
    assert!(text.contains("METAR SCTB 181300Z"));
    assert!(text.contains("\"sourceUrl\":\"https://aipchile.dgac.gob.cl/metar"));
}

#[tokio::test]
async fn official_taf_scvh_unavailable() {
    let clock = Clock::at(parse_utc_iso("2026-11-18T13:00:00Z").unwrap().epoch_ms());
    let state = AppState::for_tests(ifis_fetch(), clock, Arc::new(|| 0.5));
    let app = router_with(tempdir_dist(), state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/official/taf?icao=SCVH")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(text.contains("\"unavailable\":true"));
    assert!(text.contains("no_taf_for_designator"));
}

#[tokio::test]
async fn official_gamet_opmet_only() {
    let clock = Clock::at(parse_utc_iso("2026-11-18T13:00:00Z").unwrap().epoch_ms());
    let state = AppState::for_tests(ifis_fetch(), clock, Arc::new(|| 0.5));
    let app = router_with(tempdir_dist(), state);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/official/gamet?fir=SCEZ")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.to_vec()).unwrap();
    assert!(text.contains("opmet_only"));
}

fn tempdir_dist() -> std::path::PathBuf {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("missing-dist");
    std::mem::forget(dir);
    path
}