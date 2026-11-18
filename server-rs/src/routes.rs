//! `/api/andes/*` and `/api/generated/*`. Status codes and JSON key order follow
//! the Next handlers. Bodies are `JSON.stringify` bytes.

use std::collections::HashMap;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use serde_json::Value;

use crate::airfields::{self, AndesAirfield};
use crate::cache::{Clock, FetchFn, UpstreamResponse};
use crate::ceiling::ceiling_from_hourly;
use crate::domain::{self, SCTB_LAT, SCTB_LON};
use crate::field;
use crate::js_json::{js_opt_num, Js};
use crate::metar::{generate_model_metar, ModelProduct, STAMP};
use crate::product_log::{new_log_id, LogEntry};
use crate::regrid::FineCell;
use crate::series::Series;
use crate::state::AppState;
use crate::stations;
use crate::taf::generate_model_taf;
use crate::utc::parse_utc_iso;

pub async fn models(State(state): State<AppState>) -> Response {
    let models = state
        .probes
        .probe(&state.cache, SCTB_LAT, SCTB_LON, state.clock.now_ms())
        .await;
    let items = models
        .iter()
        .map(|model| {
            let mut fields = vec![
                ("id", Js::Str(model.id)),
                ("label", Js::Str(model.label)),
                ("available", Js::Bool(model.available)),
            ];
            if let Some(warning) = &model.warning {
                fields.push(("warning", Js::Str(warning)));
            }
            Js::Obj(fields)
        })
        .collect();
    let fetched_at = state.clock.now_iso();
    json(
        StatusCode::OK,
        Js::Obj(vec![
            ("models", Js::Arr(items)),
            ("fetchedAt", Js::Str(&fetched_at)),
        ])
        .to_bytes(),
    )
}

pub async fn times(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let model = query
        .get("model")
        .map(String::as_str)
        .unwrap_or("gfs_seamless");
    if crate::models::model_by_id(model).is_none() {
        return json(
            StatusCode::INTERNAL_SERVER_ERROR,
            error_bytes("Unknown model"),
        );
    }
    let fetched = field::fetch_point_hourly(&state.cache, model, SCTB_LAT, SCTB_LON, 48, 0).await;
    if !fetched.ok {
        let error = fetched.error;
        return json(
            StatusCode::OK,
            Js::Obj(vec![("times", Js::Arr(vec![])), ("error", Js::Str(&error))]).to_bytes(),
        );
    }
    let times = string_array(&fetched.times);
    json(StatusCode::OK, Js::Obj(vec![("times", times)]).to_bytes())
}

pub async fn ceiling(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let Some(model) = crate::models::parse_andes_model_id(query.get("model").map(String::as_str))
    else {
        return json(StatusCode::BAD_REQUEST, error_bytes("Invalid model"));
    };
    let valid_ms = match query.get("validTime").map(String::as_str) {
        Some(text) if !text.is_empty() => parse_utc_iso(text)
            .map(|stamp| stamp.epoch_ms())
            .unwrap_or(state.clock.now_ms()),
        _ => state.clock.now_ms(),
    };
    match field::fetch_ceiling_grid(&state.cache, model, valid_ms).await {
        Ok(grid) => json(StatusCode::OK, ceiling_json(&grid)),
        Err(error) => json(StatusCode::INTERNAL_SERVER_ERROR, error_bytes(&error)),
    }
}

pub async fn slice(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let Some(model) = crate::models::parse_andes_model_id(query.get("model").map(String::as_str))
    else {
        return json(StatusCode::BAD_REQUEST, error_bytes("Invalid model"));
    };
    let hpa = js_number(query.get("hpa").map(String::as_str).unwrap_or("850"));
    let valid_raw = query.get("validTime").map(String::as_str);
    let (rows, cols) = domain::default_grid_shape();
    let grid = domain::domain_grid(rows, cols);
    let list = match field::fetch_multi(&state.cache, &grid, model).await {
        Ok(list) => list,
        Err(error) => {
            return json(
                StatusCode::OK,
                Js::Obj(vec![
                    ("unavailable", Js::Str(&error)),
                    ("values", Js::Arr(vec![])),
                    (
                        "gridShape",
                        Js::Obj(vec![
                            ("rows", Js::Num(rows as f64)),
                            ("cols", Js::Num(cols as f64)),
                        ]),
                    ),
                ])
                .to_bytes(),
            );
        }
    };
    let mut values = Vec::new();
    for point in &list {
        let hourly = point.get("hourly").cloned().unwrap_or(Value::Null);
        let times = field::time_strings(&hourly);
        let index = hour_index(&state.clock, &times, valid_raw);
        let (temp, cloud) = field::slice_at_pressure(&hourly, index, hpa);
        let lat = point
            .get("latitude")
            .and_then(Value::as_f64)
            .unwrap_or(f64::NAN);
        let lon = point
            .get("longitude")
            .and_then(Value::as_f64)
            .unwrap_or(f64::NAN);
        values.push(Js::Obj(vec![
            (
                "lat",
                js_opt_num(Some(lat).filter(|value| value.is_finite())),
            ),
            (
                "lon",
                js_opt_num(Some(lon).filter(|value| value.is_finite())),
            ),
            ("tempC", js_opt_num(temp)),
            ("cloudPct", js_opt_num(cloud)),
        ]));
    }
    let center = field::fetch_point_hourly(&state.cache, model, SCTB_LAT, SCTB_LON, 48, 0).await;
    let mut slice_height = None;
    if center.ok {
        let index = hour_index(&state.clock, &center.times, valid_raw);
        let key = format!("geopotential_height_{hpa}hPa");
        slice_height = center
            .hourly
            .get(&key)
            .and_then(Value::as_array)
            .and_then(|items| items.get(index))
            .and_then(Value::as_f64);
    }
    let valid_time = match valid_raw {
        Some(text) => text.to_string(),
        None => center.times.first().cloned().unwrap_or_default(),
    };
    let valid_json = if valid_raw.is_none() && (center.times.is_empty() || !center.ok) {
        Js::Null
    } else {
        Js::Str(&valid_time)
    };
    let pressure = if hpa.is_finite() {
        Js::Num(hpa)
    } else {
        Js::Null
    };
    json(
        StatusCode::OK,
        Js::Obj(vec![
            ("pressureHpa", pressure),
            ("values", Js::Arr(values)),
            (
                "gridShape",
                Js::Obj(vec![
                    ("rows", Js::Num(rows as f64)),
                    ("cols", Js::Num(cols as f64)),
                ]),
            ),
            ("sliceHeightM", js_opt_num(slice_height)),
            ("validTime", valid_json),
        ])
        .to_bytes(),
    )
}

pub async fn timeline(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let icao = query
        .get("icao")
        .map(|value| value.to_ascii_uppercase())
        .unwrap_or_else(|| "SCEL".to_string());
    let Some(field) = airfields::airfield(&icao) else {
        let message = format!("Unknown airfield {icao}");
        return json(StatusCode::BAD_REQUEST, error_bytes(&message));
    };
    let metar_icao = if field.has_metar {
        Some(field.icao)
    } else {
        field.nearest_metar_icao
    };
    let observation = if let Some(metar_icao) = metar_icao {
        observed(&state.awc, metar_icao).await
    } else {
        None
    };
    let mut obs_proxy: Option<String> = None;
    if !field.has_metar {
        if let Some(metar_icao) = metar_icao {
            let reference = airfields::airfield(metar_icao).unwrap_or(AndesAirfield {
                icao: "SCEL",
                name: "",
                lat: -33.393,
                lon: -70.786,
                elev_m: 0.0,
                has_metar: true,
                nearest_metar_icao: None,
            });
            let km = airfields::haversine_km(field.lat, field.lon, reference.lat, reference.lon);
            obs_proxy = Some(format!("obs: {metar_icao} (nearest METAR, {:.0} km)", km));
        } else {
            obs_proxy = Some("model only — no METAR".to_string());
        }
    }
    let mut series = Vec::new();
    for model in [
        "gfs_seamless",
        "ecmwf_ifs025",
        "icon_seamless",
        "gem_seamless",
    ] {
        series.push(model_timeline(&state, &field, model).await);
    }
    let series_json: Vec<Js<'_>> = series.iter().map(series_json).collect();
    let field_json = field_json(&field);
    let observation_label;
    let observation_points;
    let observation_json = match &observation {
        Some((label, points)) => {
            observation_label = obs_proxy.clone().unwrap_or_else(|| label.clone());
            observation_points = points
                .iter()
                .map(|point| {
                    Js::Obj(vec![
                        ("time", Js::Str(&point.time)),
                        ("ceilingFtAgl", js_opt_num(point.ceiling_ft)),
                        ("category", Js::Str(&point.category)),
                    ])
                })
                .collect();
            Js::Obj(vec![
                ("label", Js::Str(&observation_label)),
                ("points", Js::Arr(observation_points)),
            ])
        }
        None => Js::Null,
    };
    let proxy_json = match &obs_proxy {
        Some(label) => Js::Str(label),
        None => Js::Null,
    };
    json(
        StatusCode::OK,
        Js::Obj(vec![
            ("field", field_json),
            ("observation", observation_json),
            ("obsProxyLabel", proxy_json),
            ("models", Js::Arr(series_json)),
        ])
        .to_bytes(),
    )
}

pub async fn coherence(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let icao = query
        .get("icao")
        .map(|value| value.to_ascii_uppercase())
        .unwrap_or_else(|| "SCEL".to_string());
    let model = query
        .get("model")
        .map(String::as_str)
        .unwrap_or("gfs_seamless");
    let Some(field) = airfields::airfield(&icao) else {
        return json(StatusCode::BAD_REQUEST, error_bytes("unknown field"));
    };
    let fetched = field::fetch_point_hourly(&state.cache, model, field.lat, field.lon, 48, 0).await;
    if !fetched.ok || fetched.meta.is_none() {
        let error = if fetched.error.is_empty() {
            "model down".to_string()
        } else {
            fetched.error
        };
        return json(StatusCode::BAD_GATEWAY, error_bytes(&error));
    }
    let (metar_raw, metar_ceiling) = load_metar(&state, &icao).await;
    let (taf_raw, taf_ceiling) = load_taf(&state, &icao).await;
    let index = field::pick_hour_index(&fetched.times, state.clock.now_ms());
    let series = Series::from_json(&fetched.hourly);
    let sample = ceiling_from_hourly(&series.hourly, index, field.elev_m);
    let run_time = state.clock.now_iso();
    let model_taf = match generate_model_taf(&icao, field.elev_m, model, &run_time, &series) {
        Ok(product) => product.raw,
        Err(error) => error,
    };
    let comparison = match (sample.ceiling_ft_agl, metar_ceiling) {
        (Some(model_ft), Some(metar_ft)) => {
            let delta = (model_ft - metar_ft).abs();
            if delta < 500.0 {
                "match"
            } else if model_ft < metar_ft {
                "worse"
            } else {
                "better"
            }
        }
        _ => "unknown",
    };
    let official_taf = if taf_raw.is_empty() {
        "(no TAF)".to_string()
    } else {
        taf_raw.clone()
    };
    json(
        StatusCode::OK,
        Js::Obj(vec![(
            "views",
            Js::Obj(vec![
                (
                    "modelVsMetar",
                    Js::Obj(vec![
                        ("modelCeilingFt", js_opt_num(sample.ceiling_ft_agl)),
                        ("metarCeilingFt", js_opt_num(metar_ceiling)),
                        ("tafCeilingFt", js_opt_num(taf_ceiling)),
                        ("modelVsMetar", Js::Str(comparison)),
                        ("modelTafRaw", Js::Str(&model_taf)),
                        ("officialTafRaw", Js::Str(&official_taf)),
                    ]),
                ),
                (
                    "modelTafVsOfficial",
                    Js::Obj(vec![
                        ("model", Js::Str(&model_taf)),
                        ("official", Js::Str(&official_taf)),
                    ]),
                ),
                (
                    "officialTafVsMetar",
                    Js::Obj(vec![
                        ("taf", Js::Str(&official_taf)),
                        ("metar", Js::Str(&metar_raw)),
                    ]),
                ),
            ]),
        )])
        .to_bytes(),
    )
}

pub async fn generated_metar(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let icao = query
        .get("icao")
        .map(|value| value.to_ascii_uppercase())
        .unwrap_or_else(|| "SCTB".to_string());
    let Some(model) = crate::models::parse_andes_model_id(query.get("model").map(String::as_str))
    else {
        return json(StatusCode::BAD_REQUEST, error_bytes("Invalid model"));
    };
    let (lat, lon, elev) = point_for(&icao);
    let fetched = field::fetch_point_hourly(&state.cache, model, lat, lon, 48, 0).await;
    if !fetched.ok || fetched.meta.is_none() {
        let error = if fetched.error.is_empty() {
            "model unavailable".to_string()
        } else {
            fetched.error
        };
        return json(StatusCode::BAD_GATEWAY, error_bytes(&error));
    }
    let index = field::pick_hour_index(&fetched.times, state.clock.now_ms());
    let run_time = state.clock.now_iso();
    let valid_time = fetched
        .times
        .get(index)
        .cloned()
        .unwrap_or_else(|| run_time.clone());
    let series = Series::from_json(&fetched.hourly);
    let generated =
        match generate_model_metar(&icao, elev, model, &run_time, &valid_time, &series, index) {
            Ok(product) => product,
            Err(error) => return json(StatusCode::BAD_REQUEST, error_bytes(&error)),
        };
    finish_product(
        &state,
        "METAR",
        model,
        &run_time,
        &valid_time,
        lat,
        lon,
        &icao,
        &generated,
    )
    .await
}

pub async fn generated_taf(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let icao = query
        .get("icao")
        .map(|value| value.to_ascii_uppercase())
        .unwrap_or_else(|| "SCTB".to_string());
    let Some(model) = crate::models::parse_andes_model_id(query.get("model").map(String::as_str))
    else {
        return json(StatusCode::BAD_REQUEST, error_bytes("Invalid model"));
    };
    let (lat, lon, elev) = point_for(&icao);
    let fetched = field::fetch_point_hourly(&state.cache, model, lat, lon, 48, 0).await;
    if !fetched.ok || fetched.meta.is_none() {
        let error = if fetched.error.is_empty() {
            "model unavailable".to_string()
        } else {
            fetched.error
        };
        return json(StatusCode::BAD_GATEWAY, error_bytes(&error));
    }
    let run_time = state.clock.now_iso();
    let series = Series::from_json(&fetched.hourly);
    let generated = match generate_model_taf(&icao, elev, model, &run_time, &series) {
        Ok(product) => product,
        Err(error) => return json(StatusCode::BAD_REQUEST, error_bytes(&error)),
    };
    let valid_time = fetched
        .times
        .first()
        .cloned()
        .unwrap_or_else(|| run_time.clone());
    finish_product(
        &state,
        "TAF",
        model,
        &run_time,
        &valid_time,
        lat,
        lon,
        &icao,
        &generated,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn finish_product(
    state: &AppState,
    kind: &'static str,
    model: &str,
    run_time: &str,
    valid_time: &str,
    lat: f64,
    lon: f64,
    icao: &str,
    product: &ModelProduct,
) -> Response {
    let id = new_log_id(state.clock.now_ms(), (state.random)());
    state
        .log
        .append(&LogEntry {
            id: id.clone(),
            kind,
            model: model.to_string(),
            run_time: run_time.to_string(),
            valid_time: valid_time.to_string(),
            lat,
            lon,
            icao: icao.to_string(),
            raw: product.raw.clone(),
            created_at: run_time.to_string(),
        })
        .await;
    let mut fields = vec![("raw", Js::Str(&product.raw)), ("stamp", Js::Str(STAMP))];
    if product.vis_estimated {
        fields.push(("visEstimated", Js::Bool(true)));
    }
    if product.cld_estimated {
        fields.push(("cldEstimated", Js::Bool(true)));
    }
    if product.mid_cloud_base_unk {
        fields.push(("midCloudBaseUnk", Js::Bool(true)));
    }
    fields.push(("logId", Js::Str(&id)));
    json(StatusCode::OK, Js::Obj(fields).to_bytes())
}

fn point_for(icao: &str) -> (f64, f64, f64) {
    if let Some(field) = airfields::airfield(icao) {
        (field.lat, field.lon, field.elev_m)
    } else {
        let station = stations::require_station(icao);
        (station.lat, station.lon, station.elev_m)
    }
}

fn ceiling_json(grid: &field::CeilingGrid) -> Vec<u8> {
    if let Some(reason) = &grid.unavailable {
        return Js::Obj(vec![
            ("cells", Js::Arr(vec![])),
            ("modelRun", Js::Null),
            (
                "gridShape",
                Js::Obj(vec![
                    ("rows", Js::Num(grid.coarse_rows as f64)),
                    ("cols", Js::Num(grid.coarse_cols as f64)),
                ]),
            ),
            ("unavailable", Js::Str(reason)),
        ])
        .to_bytes();
    }
    let cells = grid.cells.cells.iter().map(cell_json).collect();
    let times = string_array(&grid.times);
    let model_run = match &grid.model_run {
        Some(stamp) => Js::Str(stamp),
        None => Js::Null,
    };
    Js::Obj(vec![
        ("cells", Js::Arr(cells)),
        ("modelRun", model_run),
        (
            "gridShape",
            Js::Obj(vec![
                ("rows", Js::Num(grid.cells.rows as f64)),
                ("cols", Js::Num(grid.cells.cols as f64)),
            ]),
        ),
        (
            "coarseShape",
            Js::Obj(vec![
                ("rows", Js::Num(grid.coarse_rows as f64)),
                ("cols", Js::Num(grid.coarse_cols as f64)),
            ]),
        ),
        ("timeLabels", times),
    ])
    .to_bytes()
}

fn cell_json(cell: &FineCell) -> Js<'_> {
    let mut fields = vec![
        ("lat", Js::Num(cell.lat)),
        ("lon", Js::Num(cell.lon)),
        ("elevM", Js::Num(cell.elev_m)),
        ("ceilingFtAgl", js_opt_num(cell.ceiling_ft_agl)),
        ("category", Js::Str(cell.category)),
        ("obscured", Js::Bool(cell.obscured)),
        ("cloudBaseMslM", js_opt_num(cell.cloud_base_msl_m)),
        ("lowCloudUnresolved", Js::Bool(cell.low_cloud_unresolved)),
    ];
    if !cell.omit_precip {
        fields.push(("precipMmH", js_opt_num(cell.precip_mm_h)));
    }
    Js::Obj(fields)
}

fn field_json(field: &AndesAirfield) -> Js<'_> {
    let mut fields = vec![
        ("icao", Js::Str(field.icao)),
        ("name", Js::Str(field.name)),
        ("lat", Js::Num(field.lat)),
        ("lon", Js::Num(field.lon)),
        ("elevM", Js::Num(field.elev_m)),
        ("hasMetar", Js::Bool(field.has_metar)),
    ];
    if let Some(icao) = field.nearest_metar_icao {
        fields.push(("nearestMetarIcao", Js::Str(icao)));
    }
    Js::Obj(fields)
}

struct TimelineSeries {
    model: String,
    label: String,
    points: Vec<TimelinePoint>,
    unavailable: Option<String>,
}

struct TimelinePoint {
    time: String,
    ceiling_ft: Option<f64>,
    category: String,
}

async fn model_timeline(state: &AppState, field: &AndesAirfield, model: &str) -> TimelineSeries {
    let fetched =
        field::fetch_point_hourly(&state.cache, model, field.lat, field.lon, 48, 24).await;
    if !fetched.ok || fetched.meta.is_none() {
        let error = if fetched.error.is_empty() {
            "Unavailable".to_string()
        } else {
            fetched.error
        };
        return TimelineSeries {
            model: model.to_string(),
            label: model.to_string(),
            points: Vec::new(),
            unavailable: Some(error),
        };
    }
    let elev = if fetched.elev_m == 0.0 {
        field.elev_m
    } else {
        fetched.elev_m
    };
    let series = Series::from_json(&fetched.hourly);
    let label = fetched
        .meta
        .map(|meta| meta.label.to_string())
        .unwrap_or_else(|| model.to_string());
    let mut points = Vec::new();
    for (index, time) in fetched.times.iter().take(24).enumerate() {
        let sample = ceiling_from_hourly(&series.hourly, index, elev);
        points.push(TimelinePoint {
            time: time.clone(),
            ceiling_ft: sample.ceiling_ft_agl,
            category: sample.ceiling_category.to_string(),
        });
    }
    TimelineSeries {
        model: model.to_string(),
        label,
        points,
        unavailable: None,
    }
}

fn series_json(series: &TimelineSeries) -> Js<'_> {
    let points = series
        .points
        .iter()
        .map(|point| {
            Js::Obj(vec![
                ("time", Js::Str(&point.time)),
                ("ceilingFtAgl", js_opt_num(point.ceiling_ft)),
                ("category", Js::Str(&point.category)),
            ])
        })
        .collect();
    let mut fields = vec![
        ("model", Js::Str(&series.model)),
        ("label", Js::Str(&series.label)),
        ("points", Js::Arr(points)),
    ];
    if let Some(reason) = &series.unavailable {
        fields.push(("unavailable", Js::Str(reason)));
    }
    Js::Obj(fields)
}

async fn observed(fetch: &FetchFn, icao: &str) -> Option<(String, Vec<TimelinePoint>)> {
    let url = format!(
        "https://aviationweather.gov/api/data/metar?ids={}&format=json&hours=36",
        form_encode(icao)
    );
    let response = fetch_json_retry(fetch, &url).await.ok()?;
    if response.status != 200 {
        return None;
    }
    let parsed: Value = serde_json::from_str(&response.body).ok()?;
    let rows = parsed.as_array()?;
    let mut points = Vec::new();
    for row in rows {
        let time = row.get("reportTime").and_then(Value::as_str).unwrap_or("");
        if time.is_empty() {
            continue;
        }
        let category = row.get("fltCat").and_then(Value::as_str).unwrap_or("UNK");
        points.push(TimelinePoint {
            time: time.to_string(),
            ceiling_ft: cloud_ceiling(row.get("clouds")),
            category: category.to_string(),
        });
    }
    points.sort_by(|left, right| left.time.cmp(&right.time));
    Some((format!("obs: {icao}"), points))
}

fn cloud_ceiling(clouds: Option<&Value>) -> Option<f64> {
    let rows = clouds?.as_array()?;
    let mut best: Option<f64> = None;
    for cloud in rows {
        let cover = cloud
            .get("cover")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_uppercase();
        if cover != "BKN" && cover != "OVC" && cover != "VV" {
            continue;
        }
        let Some(base) = cloud.get("base").and_then(Value::as_f64) else {
            continue;
        };
        best = Some(best.map(|current| current.min(base)).unwrap_or(base));
    }
    best
}

async fn load_metar(state: &AppState, icao: &str) -> (String, Option<f64>) {
    let url = format!(
        "https://aviationweather.gov/api/data/metar?ids={}&format=json",
        form_encode(icao)
    );
    if let Some(row) = awc_row(&state.awc, &url).await {
        let raw = row
            .get("rawOb")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        return (raw, cloud_ceiling(row.get("clouds")));
    }
    (mock_metar_raw(icao, &state.clock), None)
}

async fn load_taf(state: &AppState, icao: &str) -> (String, Option<f64>) {
    let url = format!(
        "https://aviationweather.gov/api/data/taf?ids={}&format=json",
        form_encode(icao)
    );
    if let Some(row) = awc_row(&state.awc, &url).await {
        let raw = row
            .get("rawTAF")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let mut best: Option<f64> = None;
        if let Some(periods) = row.get("fcsts").and_then(Value::as_array) {
            for period in periods {
                if let Some(base) = cloud_ceiling(period.get("clouds")) {
                    best = Some(best.map(|current| current.min(base)).unwrap_or(base));
                }
            }
        }
        return (raw, best);
    }
    (mock_taf_raw(icao, &state.clock), None)
}

async fn awc_row(fetch: &FetchFn, url: &str) -> Option<Value> {
    let response = fetch_json_retry(fetch, url).await.ok()?;
    if response.status != 200 {
        return None;
    }
    let parsed: Value = serde_json::from_str(&response.body).ok()?;
    let row = parsed.as_array()?.first()?.clone();
    if row.is_null() {
        None
    } else {
        Some(row)
    }
}

async fn fetch_json_retry(fetch: &FetchFn, url: &str) -> Result<UpstreamResponse, String> {
    match fetch(url.to_string()).await {
        Ok(response) if response.status != 0 => Ok(response),
        first => match fetch(url.to_string()).await {
            Ok(response) => Ok(response),
            Err(error) => Err(first.err().unwrap_or(error)),
        },
    }
}

fn mock_metar_raw(icao: &str, clock: &Clock) -> String {
    let station = stations::require_station(icao);
    format!(
        "METAR {} {} 18008KT 9999 FEW040 SCT100 16/08 Q1016 NOSIG",
        station.icao,
        zulu(clock)
    )
}

fn mock_taf_raw(icao: &str, clock: &Clock) -> String {
    let station = stations::require_station(icao);
    let zulu = zulu(clock);
    let day = &zulu[..2];
    format!(
        "TAF {} {zulu} {day}00/{day}24 18010KT 9999 FEW050 SCT120 TX23/19Z TN08/10Z BECMG 0204 13004KT SCT140 TEMPO 0813 4000 BR NSC",
        station.icao
    )
}

fn zulu(clock: &Clock) -> String {
    let parts = crate::utc::UtcStamp::from_epoch_ms(clock.now_ms()).parts();
    let minute = (parts.minute / 30) * 30;
    format!("{:02}{:02}{:02}Z", parts.day, parts.hour, minute)
}

fn hour_index(clock: &Clock, times: &[String], valid: Option<&str>) -> usize {
    match valid {
        Some(text) if !text.is_empty() => parse_utc_iso(text)
            .map(|stamp| field::pick_hour_index(times, stamp.epoch_ms()))
            .unwrap_or(0),
        _ => field::pick_hour_index(times, clock.now_ms()),
    }
}

fn string_array(values: &[String]) -> Js<'_> {
    Js::Arr(values.iter().map(|value| Js::Str(value.as_str())).collect())
}

fn json(status: StatusCode, bytes: Vec<u8>) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(bytes))
        .expect("response builder")
}

fn error_bytes(message: &str) -> Vec<u8> {
    Js::Obj(vec![("error", Js::Str(message))]).to_bytes()
}

fn js_number(text: &str) -> f64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0.0;
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

fn query_map(query: Option<&str>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some(query) = query else {
        return map;
    };
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = form_decode(key);
        if map.contains_key(&key) {
            continue;
        }
        map.insert(key, form_decode(value));
    }
    map
}

fn form_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn form_decode(value: &str) -> String {
    let plus = value.replace('+', " ");
    percent_decode(&plus)
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
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
