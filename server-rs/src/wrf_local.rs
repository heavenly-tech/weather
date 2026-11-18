//! Local WRF product written by `scripts/wrf`. Missing and stale runs share
//! one state: "No run available yet". The file is EXAMPLE or post-processed
//! output. This module does not fetch NOMADS.

use std::collections::BTreeMap;

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::Response;
use serde::Deserialize;

use crate::js_json::{js_opt_num, Js};
use crate::metar::STAMP;
use crate::state::AppState;
use crate::stations;
use crate::utc::parse_utc_iso;

pub const NO_RUN: &str = "No run available yet";

#[derive(Clone, Debug)]
pub struct Availability {
    pub available: bool,
    pub warning: Option<String>,
}

pub fn availability(state: &AppState) -> Availability {
    match load(state) {
        Load::Ready(_) => Availability {
            available: true,
            warning: None,
        },
        Load::Gap => Availability {
            available: false,
            warning: Some(NO_RUN.to_string()),
        },
    }
}

pub fn forecast_response(state: &AppState, icao: &str) -> Response {
    let station = stations::require_station(icao);
    let (source, label, warning, body) = match load(state) {
        Load::Ready(product) => {
            let hours = hours_for(&product, station.icao);
            ("live", "WRF (local)", None, forecast_body(station, &hours))
        }
        Load::Gap => (
            "fallback",
            NO_RUN,
            Some(NO_RUN),
            forecast_body(station, &[]),
        ),
    };
    ok_json(envelope(state, &body, source, label, warning))
}

pub fn times_response(state: &AppState) -> Response {
    let times = match load(state) {
        Load::Ready(product) => product_times(&product),
        Load::Gap => Vec::new(),
    };
    let mut fields = vec![("times", string_array(&times))];
    if times.is_empty() {
        fields.push(("unavailable", Js::Str(NO_RUN)));
    }
    ok_json(Js::Obj(fields).to_bytes())
}

pub fn ceiling_response(state: &AppState) -> Response {
    match load(state) {
        Load::Ready(product) => match product.grid {
            Some(grid) => {
                let cells = grid
                    .cells
                    .iter()
                    .map(|cell| {
                        Js::Obj(vec![
                            ("lat", Js::Num(cell.lat)),
                            ("lon", Js::Num(cell.lon)),
                            ("elevM", Js::Num(cell.elev_m)),
                            ("ceilingFtAgl", js_opt_num(cell.ceiling_ft_agl)),
                            ("category", Js::Str(&cell.category)),
                            ("obscured", Js::Bool(cell.obscured)),
                        ])
                    })
                    .collect();
                ok_json(
                    Js::Obj(vec![
                        ("cells", Js::Arr(cells)),
                        ("modelRun", Js::Str(&product.cycle)),
                        (
                            "gridShape",
                            Js::Obj(vec![
                                ("rows", Js::Num(grid.rows as f64)),
                                ("cols", Js::Num(grid.cols as f64)),
                            ]),
                        ),
                    ])
                    .to_bytes(),
                )
            }
            None => gap_ceiling(),
        },
        Load::Gap => gap_ceiling(),
    }
}

pub fn slice_response() -> Response {
    ok_json(
        Js::Obj(vec![
            ("unavailable", Js::Str(NO_RUN)),
            ("values", Js::Arr(vec![])),
            (
                "gridShape",
                Js::Obj(vec![("rows", Js::Num(0.0)), ("cols", Js::Num(0.0))]),
            ),
        ])
        .to_bytes(),
    )
}

pub fn coherence_response(state: &AppState) -> Response {
    let model = match load(state) {
        Load::Ready(product) => guidance_line(&product, "SCEL"),
        Load::Gap => NO_RUN.to_string(),
    };
    ok_json(
        Js::Obj(vec![(
            "views",
            Js::Obj(vec![
                (
                    "modelVsMetar",
                    Js::Obj(vec![
                        ("modelCeilingFt", Js::Null),
                        ("metarCeilingFt", Js::Null),
                        ("modelVsMetar", Js::Str("unknown")),
                    ]),
                ),
                (
                    "modelTafVsOfficial",
                    Js::Obj(vec![("model", Js::Str(&model)), ("official", Js::Str(""))]),
                ),
                (
                    "officialTafVsMetar",
                    Js::Obj(vec![("taf", Js::Str("")), ("metar", Js::Str(""))]),
                ),
            ]),
        )])
        .to_bytes(),
    )
}

pub fn generated_response(state: &AppState, icao: &str) -> Response {
    let raw = match load(state) {
        Load::Ready(product) => guidance_line(&product, icao),
        Load::Gap => NO_RUN.to_string(),
    };
    ok_json(Js::Obj(vec![("raw", Js::Str(&raw)), ("stamp", Js::Str(STAMP))]).to_bytes())
}

enum Load {
    Ready(Product),
    Gap,
}

fn load(state: &AppState) -> Load {
    let Some(dir) = &state.wrf_output_dir else {
        return Load::Gap;
    };
    let text = match std::fs::read_to_string(dir.join("latest.json")) {
        Ok(text) => text,
        Err(_) => return Load::Gap,
    };
    let product: Product = match serde_json::from_str(&text) {
        Ok(product) => product,
        Err(_) => return Load::Gap,
    };
    let Ok(cycle) = parse_utc_iso(&product.cycle) else {
        return Load::Gap;
    };
    let age_ms = state.clock.now_ms() - cycle.epoch_ms();
    let max_ms = state.wrf_max_age_hours.saturating_mul(3_600_000);
    if age_ms > max_ms {
        return Load::Gap;
    }
    Load::Ready(product)
}

fn hours_for(product: &Product, icao: &str) -> Vec<Hour> {
    product
        .stations
        .get(icao)
        .map(|series| series.hours.clone())
        .unwrap_or_default()
}

fn product_times(product: &Product) -> Vec<String> {
    if let Some(series) = product.stations.get("SCTB") {
        return series.hours.iter().map(|hour| hour.time.clone()).collect();
    }
    product
        .stations
        .values()
        .next()
        .map(|series| series.hours.iter().map(|hour| hour.time.clone()).collect())
        .unwrap_or_default()
}

fn guidance_line(product: &Product, icao: &str) -> String {
    let Some(hour) = hours_for(product, icao).into_iter().next() else {
        return NO_RUN.to_string();
    };
    let temp = hour
        .temp_c
        .map(|value| format!("{value:.1}"))
        .unwrap_or_else(|| "—".to_string());
    let fog = hour.fog_guidance.unwrap_or_default();
    let fog = if fog.is_empty() {
        "no FG/BR".to_string()
    } else {
        fog
    };
    format!(
        "MODEL GUIDANCE — NOT A METAR WRF (local) {icao} {} T{temp} {fog}",
        hour.time
    )
}

fn forecast_body(station: &stations::Station, hours: &[Hour]) -> Vec<u8> {
    let hours_json = hours
        .iter()
        .map(|hour| {
            let mut fields = vec![
                ("time", Js::Str(&hour.time)),
                ("tempC", js_opt_num(hour.temp_c)),
                ("rhPct", js_opt_num(hour.rh_pct)),
                ("precipMm", js_opt_num(hour.precip_mm)),
                ("cloudPct", js_opt_num(hour.cloud_pct)),
                ("windKt", js_opt_num(hour.wind_kt)),
                ("windDirDeg", js_opt_num(hour.wind_dir)),
                ("visKm", js_opt_num(hour.vis_km)),
                ("weatherCode", js_opt_num(hour.weather_code)),
            ];
            if let Some(dew) = hour.dewpoint_c {
                fields.push(("dewpointC", Js::Num(dew)));
            }
            if let Some(ceiling) = hour.ceiling_ft {
                fields.push(("ceilingFt", Js::Num(ceiling)));
            }
            if let Some(fog) = hour.fog_guidance.as_deref() {
                fields.push(("fogGuidance", Js::Str(fog)));
            }
            Js::Obj(fields)
        })
        .collect();
    let name = format!("{} / {}", station.city, station.name);
    Js::Obj(vec![
        ("icao", Js::Str(station.icao)),
        ("name", Js::Str(&name)),
        ("model", Js::Str("WRF (local)")),
        ("lat", Js::Num(station.lat)),
        ("lon", Js::Num(station.lon)),
        ("elevM", Js::Num(station.elev_m)),
        ("hours", Js::Arr(hours_json)),
    ])
    .to_bytes()
}

fn envelope(
    state: &AppState,
    data: &[u8],
    source: &str,
    label: &str,
    warning: Option<&str>,
) -> Vec<u8> {
    let fetched = state.clock.now_iso();
    let data_text = String::from_utf8_lossy(data);
    let mut body = format!(
        "{{\"data\":{data_text},\"source\":{},\"sourceLabel\":{},\"fetchedAt\":{}",
        json_string(source),
        json_string(label),
        json_string(&fetched)
    );
    if let Some(warning) = warning {
        body.push_str(",\"warning\":");
        body.push_str(&json_string(warning));
    }
    body.push('}');
    body.into_bytes()
}

fn gap_ceiling() -> Response {
    ok_json(
        Js::Obj(vec![
            ("cells", Js::Arr(vec![])),
            ("modelRun", Js::Null),
            (
                "gridShape",
                Js::Obj(vec![("rows", Js::Num(0.0)), ("cols", Js::Num(0.0))]),
            ),
            ("unavailable", Js::Str(NO_RUN)),
        ])
        .to_bytes(),
    )
}

fn string_array(values: &[String]) -> Js<'_> {
    Js::Arr(values.iter().map(|value| Js::Str(value)).collect())
}

fn json_string(value: &str) -> String {
    String::from_utf8(Js::Str(value).to_bytes()).expect("json string")
}

fn ok_json(bytes: Vec<u8>) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(bytes))
        .expect("response")
}

#[derive(Deserialize)]
struct Product {
    cycle: String,
    stations: BTreeMap<String, StationSeries>,
    #[serde(default)]
    grid: Option<Grid>,
}

#[derive(Deserialize)]
struct StationSeries {
    hours: Vec<Hour>,
}

#[derive(Clone, Deserialize)]
struct Hour {
    time: String,
    #[serde(rename = "tempC")]
    temp_c: Option<f64>,
    #[serde(rename = "dewpointC")]
    dewpoint_c: Option<f64>,
    #[serde(rename = "rhPct")]
    rh_pct: Option<f64>,
    #[serde(rename = "precipMm")]
    precip_mm: Option<f64>,
    #[serde(rename = "cloudPct")]
    cloud_pct: Option<f64>,
    #[serde(rename = "windKt")]
    wind_kt: Option<f64>,
    #[serde(rename = "windDirDeg")]
    wind_dir: Option<f64>,
    #[serde(rename = "visKm")]
    vis_km: Option<f64>,
    #[serde(rename = "weatherCode")]
    weather_code: Option<f64>,
    #[serde(rename = "ceilingFt")]
    ceiling_ft: Option<f64>,
    #[serde(rename = "fogGuidance")]
    fog_guidance: Option<String>,
}

#[derive(Deserialize)]
struct Grid {
    rows: usize,
    cols: usize,
    cells: Vec<Cell>,
}

#[derive(Deserialize)]
struct Cell {
    lat: f64,
    lon: f64,
    #[serde(rename = "elevM")]
    elev_m: f64,
    #[serde(rename = "ceilingFtAgl")]
    ceiling_ft_agl: Option<f64>,
    category: String,
    obscured: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::cache::Clock;
    use crate::utc::parse_utc_iso;

    fn state_at(dir: Option<PathBuf>, stamp: &str) -> AppState {
        let mut state = AppState::for_tests(
            Arc::new(|_| Box::pin(async { Err("nomads must not be called".to_string()) })),
            Clock::at(parse_utc_iso(stamp).unwrap().epoch_ms()),
            Arc::new(|| 0.5),
        );
        state.wrf_output_dir = dir;
        state.wrf_max_age_hours = 18;
        state
    }

    fn fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/wrf")
    }

    async fn body_of(response: Response) -> String {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn missing_run_says_no_run_available_yet() {
        let state = state_at(None, "2026-11-18T06:00:00Z");
        let text = body_of(forecast_response(&state, "SCEL")).await;
        assert!(text.contains("\"sourceLabel\":\"No run available yet\""));
        assert!(text.contains("\"warning\":\"No run available yet\""));
        assert!(text.contains("\"hours\":[]"));
        assert!(!text.contains("nomads"), "{text}");
        let ceiling = body_of(ceiling_response(&state)).await;
        assert!(ceiling.contains("\"unavailable\":\"No run available yet\""));
    }

    #[tokio::test]
    async fn example_product_is_served_and_a_stale_cycle_is_not() {
        let fresh = state_at(Some(fixture_dir()), "2026-11-18T06:00:00Z");
        let text = body_of(forecast_response(&fresh, "SCEL")).await;
        assert!(text.contains("\"model\":\"WRF (local)\""));
        assert!(text.contains("\"fogGuidance\":\"FG\""));
        assert!(text.contains("\"tempC\":12.5"));
        assert!(!text.contains("No run available yet"), "{text}");
        let generated = body_of(generated_response(&fresh, "SCEL")).await;
        assert!(generated.contains("NOT A METAR"));
        assert!(generated.contains("FG"));
        let stale = state_at(Some(fixture_dir()), "2026-11-19T12:00:00Z");
        let stale_text = body_of(forecast_response(&stale, "SCEL")).await;
        assert!(stale_text.contains("No run available yet"));
        assert!(!stale_text.contains("12.5"), "{stale_text}");
    }

    #[tokio::test]
    async fn routes_do_not_call_the_upstream_for_wrf_local() {
        let state = state_at(Some(fixture_dir()), "2026-11-18T06:00:00Z");
        let dist = tempfile::tempdir().unwrap();
        let response = crate::app::router_with(dist.path().to_path_buf(), state)
            .oneshot(
                Request::builder()
                    .uri("/api/forecast?icao=SCTB&model=wrf_local")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let text = body_of(response).await;
        assert!(text.contains("\"tempC\":7"));
        assert!(text.contains("\"fogGuidance\":\"BR\""));
        assert!(!text.contains("nomads"), "{text}");
    }
}
