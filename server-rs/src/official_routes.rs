//! `GET /api/official/metar`, `/api/official/taf`, `/api/official/gamet`.

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::response::Response;

use crate::js_json::Js;
use crate::official_cache::{OfficialGametPayload, OfficialMetarPayload, OfficialTafPayload};
use crate::routes::query_map;
use crate::state::AppState;

pub async fn official_metar(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let icao = query
        .get("icao")
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "SCEL".to_string());
    let payload = state.official.metar(&icao).await;
    json_response(StatusCode::OK, metar_bytes(&payload))
}

pub async fn official_taf(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let icao = query
        .get("icao")
        .map(|value| value.trim().to_ascii_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "SCEL".to_string());
    let payload = state.official.taf(&icao).await;
    json_response(StatusCode::OK, taf_bytes(&payload))
}

pub async fn official_gamet(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let fir = query
        .get("fir")
        .map(String::as_str)
        .unwrap_or("SANTIAGO");
    let payload = state.official.gamet(fir);
    json_response(StatusCode::OK, gamet_bytes(&payload))
}

fn json_response(status: StatusCode, body: Vec<u8>) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .expect("response")
}

fn metar_bytes(payload: &OfficialMetarPayload) -> Vec<u8> {
    Js::Obj(vec![
        ("icao", Js::Str(&payload.icao)),
        ("raw", Js::Str(&payload.raw)),
        ("kind", Js::Str(&payload.kind)),
        ("source", Js::Str(payload.source)),
        ("officialLabel", Js::Str(payload.official_label)),
        ("sourceUrl", Js::Str(&payload.source_url)),
        ("fetchedAt", Js::Str(&payload.fetched_at)),
        ("issuedAt", opt_str(payload.issued_at.as_deref())),
        ("ageSeconds", Js::Num(payload.age_seconds as f64)),
        ("stale", Js::Bool(payload.stale)),
        ("unavailable", Js::Bool(payload.unavailable)),
        ("unavailableReason", opt_str(payload.unavailable_reason.as_deref())),
    ])
    .to_bytes()
}

fn taf_bytes(payload: &OfficialTafPayload) -> Vec<u8> {
    Js::Obj(vec![
        ("icao", Js::Str(&payload.icao)),
        ("raw", Js::Str(&payload.raw)),
        ("source", Js::Str(payload.source)),
        ("officialLabel", Js::Str(payload.official_label)),
        ("sourceUrl", Js::Str(&payload.source_url)),
        ("fetchedAt", Js::Str(&payload.fetched_at)),
        ("issuedAt", opt_str(payload.issued_at.as_deref())),
        ("ageSeconds", Js::Num(payload.age_seconds as f64)),
        ("stale", Js::Bool(payload.stale)),
        ("unavailable", Js::Bool(payload.unavailable)),
        ("unavailableReason", opt_str(payload.unavailable_reason.as_deref())),
    ])
    .to_bytes()
}

fn opt_str(value: Option<&str>) -> Js<'_> {
    match value {
        Some(text) => Js::Str(text),
        None => Js::Null,
    }
}

fn gamet_bytes(payload: &OfficialGametPayload) -> Vec<u8> {
    Js::Obj(vec![
        ("fir", Js::Str(&payload.fir)),
        ("source", Js::Str(payload.source)),
        ("officialLabel", Js::Str(payload.official_label)),
        ("fetchedAt", Js::Str(&payload.fetched_at)),
        ("unavailable", Js::Bool(payload.unavailable)),
        ("unavailableReason", Js::Str(&payload.unavailable_reason)),
    ])
    .to_bytes()
}