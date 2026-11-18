//! Desk routes that were still on Next: config, METAR, TAF, forecast, GRAMET,
//! GAMET, synoptic, and the 3D field. JSON key order follows the TypeScript
//! handlers. An Open-Meteo 200 body that is not JSON is `502` JSON rather than
//! a Next HTML error page. The 502 body is a fixed sentence plus a short
//! code. An AWC METAR or TAF that is unreachable, empty, or not JSON is an
//! observations-unavailable envelope. A fabricated METAR or TAF is returned
//! only when `WEATHER_DEV_MOCK=1`.

use std::collections::BTreeMap;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use serde_json::Value;

use crate::airfields;
use crate::awc::{self, CloudLayer, MetarObs, TafObs, TafPeriod};
use crate::cache::{error_text, UpstreamResponse};
use crate::field::pick_hour_index;
use crate::js_json::{js_opt_num, Js};
use crate::round::js_round;
use crate::routes::{form_encode, query_map};
use crate::state::AppState;
use crate::stations::{self, Station};
use crate::utc::UtcStamp;

const LEVELS: [(u16, f64); 6] = [
    (1000, 5.0),
    (925, 25.0),
    (850, 50.0),
    (700, 100.0),
    (500, 180.0),
    (300, 300.0),
];

pub async fn config(State(_state): State<AppState>) -> Response {
    let token = std::env::var("CESIUM_ION_TOKEN")
        .ok()
        .or_else(|| std::env::var("NEXT_PUBLIC_CESIUM_ION_TOKEN").ok())
        .filter(|value| !value.is_empty());
    let token_json = match &token {
        Some(value) => Js::Str(value),
        None => Js::Null,
    };
    json_only(
        StatusCode::OK,
        Js::Obj(vec![("cesiumIonToken", token_json)]).to_bytes(),
    )
}

pub async fn metar(State(state): State<AppState>, request: Request) -> Response {
    let icao = icao_param(request.uri().query());
    let url = format!(
        "https://aviationweather.gov/api/data/metar?ids={}&format=json",
        form_encode(&icao)
    );
    match fetch_rows(&state, &url).await {
        Err(HttpFail::Down { code }) => awc_gap(
            &state,
            code,
            mock_metar_json(&state, &icao),
            "Mock METAR (dev flag; not an observation)",
        ),
        Ok(rows) if rows.is_empty() => awc_gap(
            &state,
            "awc-empty",
            mock_metar_json(&state, &icao),
            "Mock METAR (dev flag; not an observation)",
        ),
        Ok(rows) => {
            let mut parsed = awc::parse_metar(&rows[0]);
            fill_metar_name(&mut parsed, &icao);
            product(
                &state,
                metar_json(&parsed),
                "live",
                "Live METAR from NOAA Aviation Weather Center",
                None,
            )
        }
    }
}

pub async fn taf(State(state): State<AppState>, request: Request) -> Response {
    let icao = icao_param(request.uri().query());
    let url = format!(
        "https://aviationweather.gov/api/data/taf?ids={}&format=json",
        form_encode(&icao)
    );
    match fetch_rows(&state, &url).await {
        Err(HttpFail::Down { code }) => awc_gap(
            &state,
            code,
            mock_taf_json(&state, &icao),
            "Mock TAF (dev flag; not a forecast)",
        ),
        Ok(rows) if rows.is_empty() => awc_gap(
            &state,
            "awc-empty",
            mock_taf_json(&state, &icao),
            "Mock TAF (dev flag; not a forecast)",
        ),
        Ok(rows) => {
            let mut parsed = awc::parse_taf(&rows[0]);
            fill_taf_name(&mut parsed, &icao);
            product(
                &state,
                taf_json(&parsed),
                "live",
                "Live TAF from NOAA Aviation Weather Center",
                None,
            )
        }
    }
}

pub async fn forecast(State(state): State<AppState>, request: Request) -> Response {
    let icao = icao_param(request.uri().query());
    let station = stations::require_station(&icao);
    if let Some(body) = fetch_wrf(&state, station).await {
        return product(&state, body, "live", "Live WRF-DMC from MeteoChile", None);
    }
    let url = surface_url(station.lat, station.lon, 5);
    match fetch_open_meteo(&state, &url).await {
        Err(OpenFail::BadJson(_error)) => gateway("bad-json"),
        Err(OpenFail::Down(error)) => product(
            &state,
            mock_forecast_json(&state, station),
            "mock",
            "Mock point forecast (model circuit down)",
            Some(error),
        ),
        Ok(value) => {
            let data = point_forecast(
                station,
                "GFS via Open-Meteo (WRF-DMC parent model)",
                &as_single(&value),
            );
            let label = if std::env::var("METEOCHILE_TOKEN")
                .ok()
                .is_some_and(|value| !value.is_empty())
            {
                "Open-Meteo GFS (MeteoChile WRF did not return a series)"
            } else {
                "Open-Meteo GFS fallback — set METEOCHILE_USER and METEOCHILE_TOKEN for WRF-DMC"
            };
            let warning = if stations::meteochile_id(station.icao).is_none() {
                Some(format!(
                    "No MeteoChile station id mapped for {}; GFS is used at the aerodrome coordinates.",
                    station.icao
                ))
            } else {
                None
            };
            product(&state, data, "fallback", label, warning)
        }
    }
}

pub async fn gramet(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let from_icao = query
        .get("from")
        .map(|value| value.to_ascii_uppercase())
        .unwrap_or_else(|| "SCEL".to_string());
    let to_icao = query
        .get("to")
        .map(|value| value.to_ascii_uppercase())
        .unwrap_or_else(|| "SCTE".to_string());
    let from = stations::require_station(&from_icao);
    let to = stations::require_station(&to_icao);
    let points = great_circle(from.lat, from.lon, to.lat, to.lon, 6);
    let url = pressure_url_multi(&points, 1);
    match fetch_open_meteo(&state, &url).await {
        Err(OpenFail::BadJson(_error)) => gateway("bad-json"),
        Err(OpenFail::Down(error)) => {
            let warning = format!("Open-Meteo did not return a route sounding: {error}");
            product(
                &state,
                mock_gramet_json(&state, from, to),
                "mock",
                "Mock GRAMET (model circuit down)",
                Some(warning),
            )
        }
        Ok(value) => {
            let list = as_list(&value);
            let mut snaps = Vec::new();
            let mut level_rows = Vec::new();
            let mut metas = Vec::new();
            for (index, response) in list.iter().enumerate() {
                let hourly = response.get("hourly").cloned().unwrap_or(Value::Null);
                let times = time_strings(&hourly);
                let hour = pick_hour_index(&times, state.clock.now_ms());
                let point = points.get(index).copied().unwrap_or((
                    response
                        .get("latitude")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    response
                        .get("longitude")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                ));
                let target_lat = response
                    .get("latitude")
                    .and_then(Value::as_f64)
                    .unwrap_or(point.0);
                let target_lon = response
                    .get("longitude")
                    .and_then(Value::as_f64)
                    .unwrap_or(point.1);
                let used = if index < points.len() {
                    points[index]
                } else {
                    (target_lat, target_lon)
                };
                let km = js_round(airfields::haversine_km(from.lat, from.lon, used.0, used.1));
                let label = if index == 0 {
                    Some(from.icao)
                } else if index + 1 == list.len() {
                    Some(to.icao)
                } else {
                    None
                };
                snaps.push(surface_snapshot(&hourly, hour));
                level_rows.push(extract_levels(&hourly, hour));
                metas.push((
                    km,
                    response
                        .get("latitude")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    response
                        .get("longitude")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                    label,
                ));
            }
            let columns: Vec<Js<'_>> = metas
                .iter()
                .enumerate()
                .map(|(index, (km, lat, lon, label))| {
                    column_json(*km, *lat, *lon, *label, &snaps[index], &level_rows[index])
                })
                .collect();
            let distance = js_round(airfields::haversine_km(from.lat, from.lon, to.lat, to.lon));
            let valid = state.clock.now_iso();
            let body = Js::Obj(vec![
                ("fromIcao", Js::Str(from.icao)),
                ("toIcao", Js::Str(to.icao)),
                ("fromName", Js::Str(from.city)),
                ("toName", Js::Str(to.city)),
                ("validTime", Js::Str(&valid)),
                ("distanceKm", Js::Num(distance)),
                ("columns", Js::Arr(columns)),
            ])
            .to_bytes();
            product(
                &state,
                body,
                "derived",
                "Derived GRAMET from GFS pressure levels (Open-Meteo)",
                None,
            )
        }
    }
}

pub async fn gamet(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let fir = stations::parse_fir(query.get("fir").map(String::as_str));
    let stations_in_fir: Vec<&Station> = stations::chile_stations()
        .into_iter()
        .filter(|station| stations::fir_id(station.icao) == fir.id)
        .collect();
    let representative = stations_in_fir.get(stations_in_fir.len() / 2).copied();
    let sigmet_fetch = fetch_rows(
        &state,
        "https://aviationweather.gov/api/data/isigmet?format=json",
    );
    let model_fetch = async {
        match representative {
            Some(station) => {
                fetch_open_meteo(&state, &pressure_url(station.lat, station.lon, 1)).await
            }
            None => Err(OpenFail::Down("No station".to_string())),
        }
    };
    let (sigmet_result, model_result) = tokio::join!(sigmet_fetch, model_fetch);
    let sigmets = match &sigmet_result {
        Ok(rows) => rows
            .iter()
            .filter(|row| sigmet_in_fir(row, fir.id))
            .cloned()
            .collect(),
        Err(_) => Vec::new(),
    };
    if let Err(OpenFail::BadJson(_)) = &model_result {
        return gateway("bad-json");
    }
    let sigmet_json = sigmet_list(&sigmets);
    if let Err(OpenFail::Down(error)) = &model_result {
        let warning = format!("Could not build a live-derived GAMET: {error}");
        return product(
            &state,
            mock_gamet_json(&state, fir, &sigmet_json),
            "mock",
            "Mock GAMET (model circuit down)",
            Some(warning),
        );
    }
    let value = model_result.ok().unwrap_or(Value::Null);
    let response = as_single(&value);
    let hourly = response.get("hourly").cloned().unwrap_or(Value::Null);
    let times = time_strings(&hourly);
    let index = pick_hour_index(&times, state.clock.now_ms());
    let snap = surface_snapshot(&hourly, index);
    let levels = extract_levels(&hourly, index);
    let body = live_gamet_json(
        &state,
        fir,
        &snap,
        &levels,
        &sigmet_json,
        sigmet_result.is_err(),
    );
    let warning = match &sigmet_result {
        Err(HttpFail::Down { code }) => Some(format!(
            "SIGMET circuit unavailable ({code}). Hazards section has no live SIGMETs."
        )),
        _ => None,
    };
    product(
        &state,
        body,
        "derived",
        "Derived GAMET-style bulletin (GFS + AWC SIGMETs). Official DGAC GAMET stays on OPMET.",
        warning,
    )
}

pub async fn synoptic(State(state): State<AppState>) -> Response {
    product(
        &state,
        synoptic_json(),
        "live",
        "NOAA WPC International Desk charts (proxied)",
        None,
    )
}

pub async fn synoptic_image(State(state): State<AppState>, request: Request) -> Response {
    let query = query_map(request.uri().query());
    let id = query.get("id").map(String::as_str).unwrap_or("sam-12");
    let Some(origin) = synoptic_origin(id) else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/plain;charset=UTF-8")
            .body(Body::from("Unknown synoptic product"))
            .expect("response");
    };
    match (state.binary)(origin.to_string()).await {
        Err(_error) => chart_failed("transport"),
        Ok(response) if !(200..300).contains(&response.status) => {
            chart_failed(&format!("http-{}", response.status))
        }
        Ok(response) => {
            let content_type = if response.content_type.contains("image") {
                response.content_type
            } else {
                "image/gif".to_string()
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CACHE_CONTROL, "public, max-age=300")
                .body(Body::from(response.body))
                .expect("response")
        }
    }
}

pub async fn viz(State(state): State<AppState>, request: Request) -> Response {
    let icao = icao_param(request.uri().query());
    let focus = stations::require_station(&icao);
    let stations_list = stations::chile_stations();
    let ids = stations_list
        .iter()
        .map(|station| station.icao)
        .collect::<Vec<_>>()
        .join(",");
    let metar_url = format!(
        "https://aviationweather.gov/api/data/metar?ids={}&format=json",
        form_encode(&ids)
    );
    let model_url = pressure_url(focus.lat, focus.lon, 1);
    let (metar_result, model_result) = tokio::join!(
        fetch_rows(&state, &metar_url),
        fetch_open_meteo(&state, &model_url)
    );
    if let Err(OpenFail::BadJson(_)) = &model_result {
        return gateway("bad-json");
    }
    let metars_down = matches!(metar_result, Err(HttpFail::Down { .. }));
    let model_down = matches!(model_result, Err(OpenFail::Down(_)));
    if metars_down && model_down {
        let warning = match (&metar_result, &model_result) {
            (Ok(_), Err(OpenFail::Down(error))) => error.clone(),
            (Err(HttpFail::Down { code }), _) => code.to_string(),
            _ => String::new(),
        };
        return product(
            &state,
            mock_viz_json(),
            "mock",
            "Mock 3D field (weather circuit down)",
            Some(warning),
        );
    }
    let mut metars = BTreeMap::new();
    if let Ok(rows) = &metar_result {
        for row in rows {
            let parsed = awc::parse_metar(row);
            if !parsed.icao.is_empty() {
                metars.insert(parsed.icao.clone(), parsed);
            }
        }
    }
    let (levels, cloud, precip) = if let Ok(value) = &model_result {
        let hourly = as_single(value)
            .get("hourly")
            .cloned()
            .unwrap_or(Value::Null);
        let index = pick_hour_index(&time_strings(&hourly), state.clock.now_ms());
        let snap = surface_snapshot(&hourly, index);
        (
            extract_levels(&hourly, index),
            snap.cloud_pct,
            snap.precip_mm,
        )
    } else {
        (mock_levels(14.0), None, None)
    };
    let mut prepared = Vec::new();
    for station in &stations_list {
        let metar = metars.get(station.icao);
        let category = metar
            .map(|item| item.flight_category.clone())
            .unwrap_or_else(|| "UNK".to_string());
        prepared.push((station, metar, category, station.icao == focus.icao));
    }
    let data: Vec<Js<'_>> = prepared
        .iter()
        .map(|(station, metar, category, focus_station)| {
            viz_station_json(
                station,
                *metar,
                category,
                if *focus_station { cloud } else { None },
                if *focus_station { precip } else { None },
                if *focus_station { &levels } else { &[] },
            )
        })
        .collect();
    let (source, label, warning) = if metars_down {
        let error = match &metar_result {
            Err(HttpFail::Down { code }) => code.to_string(),
            _ => String::new(),
        };
        (
            "fallback",
            "GFS column only (METAR circuit down)",
            Some(error),
        )
    } else {
        (
            "live",
            "Live METARs plus GFS column at the selected aerodrome",
            None,
        )
    };
    product(&state, Js::Arr(data).to_bytes(), source, label, warning)
}

enum HttpFail {
    Down { code: &'static str },
}

enum OpenFail {
    Down(String),
    BadJson(String),
}

async fn fetch_rows(state: &AppState, url: &str) -> Result<Vec<Value>, HttpFail> {
    let response = fetch_retry(&state.awc, url)
        .await
        .map_err(|_| HttpFail::Down { code: "awc-down" })?;
    if response.status == 204 || response.status != 200 {
        return Err(HttpFail::Down { code: "awc-down" });
    }
    match serde_json::from_str::<Value>(&response.body) {
        Ok(Value::Array(rows)) => Ok(rows),
        Ok(_) => Ok(Vec::new()),
        Err(_) => Err(HttpFail::Down {
            code: "awc-bad-json",
        }),
    }
}

async fn fetch_open_meteo(state: &AppState, url: &str) -> Result<Value, OpenFail> {
    let response = state
        .cache
        .cached_fetch(url, None)
        .await
        .map_err(OpenFail::Down)?;
    if response.status != 200 {
        return Err(OpenFail::Down(error_text(
            &response.body,
            response.status,
            &response.status_text,
        )));
    }
    serde_json::from_str(&response.body).map_err(|error| OpenFail::BadJson(error.to_string()))
}

async fn fetch_retry(fetch: &crate::cache::FetchFn, url: &str) -> Result<UpstreamResponse, String> {
    match fetch(url.to_string()).await {
        Ok(response) if response.status != 0 => Ok(response),
        first => match fetch(url.to_string()).await {
            Ok(response) => Ok(response),
            Err(error) => Err(first.err().unwrap_or(error)),
        },
    }
}

async fn fetch_wrf(state: &AppState, station: &Station) -> Option<Vec<u8>> {
    let user = std::env::var("METEOCHILE_USER")
        .ok()
        .filter(|value| !value.is_empty());
    let token = std::env::var("METEOCHILE_TOKEN")
        .ok()
        .filter(|value| !value.is_empty());
    let id = stations::meteochile_id(station.icao)?;
    let (Some(user), Some(token)) = (user, token) else {
        return None;
    };
    let url = format!(
        "https://climatologia.meteochile.gob.cl/application/serviciosb/getDatosModelo/{id}?usuario={}&token={}",
        form_encode(&user),
        form_encode(&token)
    );
    let Ok(response) = fetch_retry(&state.awc, &url).await else {
        return None;
    };
    if response.status != 200 {
        return None;
    }
    let Ok(payload) = serde_json::from_str::<Value>(&response.body) else {
        return None;
    };
    let hours = flatten_wrf(&payload);
    if hours.is_empty() {
        return None;
    }
    let lat = payload
        .pointer("/estacionDatos/LatitudDecimal")
        .and_then(Value::as_f64)
        .unwrap_or(station.lat);
    let lon = payload
        .pointer("/estacionDatos/LongitudDecimal")
        .and_then(Value::as_f64)
        .unwrap_or(station.lon);
    let name = format!("{} / {}", station.city, station.name);
    Some(forecast_json(
        station.icao,
        &name,
        "WRF-DMC (MeteoChile)",
        lat,
        lon,
        Some(station.elev_m),
        &hours,
    ))
}

fn flatten_wrf(payload: &Value) -> Vec<ForecastHour> {
    let mut hours: BTreeMap<String, ForecastHour> = BTreeMap::new();
    let Some(elementos) = payload.get("elementos").and_then(Value::as_object) else {
        return Vec::new();
    };
    for value in elementos.values() {
        let nombre = value
            .pointer("/nombreElemento/nombre")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        let campo = value
            .pointer("/nombreElemento/campo")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        let label = format!("{nombre} {campo}");
        let Some(object) = value.as_object() else {
            continue;
        };
        for (key, series) in object {
            if key == "nombreElemento" || !series.is_object() {
                continue;
            }
            let Some(points) = series.as_object() else {
                continue;
            };
            for point in points.values() {
                let time = point
                    .get("fecha")
                    .and_then(Value::as_str)
                    .or_else(|| point.get("fechaLocal").and_then(Value::as_str));
                let Some(time) = time else { continue };
                let Some(valor) = point.get("valorPronosticado").and_then(Value::as_f64) else {
                    continue;
                };
                let Some(stamp) = js_date_iso(time) else {
                    continue;
                };
                let hour = hours
                    .entry(stamp.clone())
                    .or_insert_with(|| ForecastHour::empty(stamp));
                if label.contains("temp") {
                    hour.temp_c = Some(valor);
                } else if label.contains("humedad") || label.contains("hr") {
                    hour.rh_pct = Some(valor);
                } else if label.contains("precip") || label.contains("agua") {
                    hour.precip_mm = Some(valor);
                } else if label.contains("nube") || label.contains("cloud") {
                    hour.cloud_pct = Some(valor);
                } else if label.contains("viento")
                    && (label.contains("dir") || label.contains("direccion"))
                {
                    hour.wind_dir = Some(valor);
                } else if label.contains("viento") {
                    hour.wind_kt = Some(js_round(valor / 1.852));
                }
            }
        }
    }
    hours.into_values().collect()
}

fn js_date_iso(text: &str) -> Option<String> {
    if let Ok(stamp) = crate::utc::parse_utc_iso(text) {
        return Some(stamp.to_iso());
    }
    None
}

struct ForecastHour {
    time: String,
    temp_c: Option<f64>,
    rh_pct: Option<f64>,
    precip_mm: Option<f64>,
    cloud_pct: Option<f64>,
    wind_kt: Option<f64>,
    wind_dir: Option<f64>,
    vis_km: Option<f64>,
    weather_code: Option<f64>,
}

impl ForecastHour {
    fn empty(time: String) -> Self {
        Self {
            time,
            temp_c: None,
            rh_pct: None,
            precip_mm: None,
            cloud_pct: None,
            wind_kt: None,
            wind_dir: None,
            vis_km: None,
            weather_code: None,
        }
    }
}

struct Snap {
    surface_temp_c: Option<f64>,
    cloud_pct: Option<f64>,
    precip_mm: Option<f64>,
    weather_code: Option<f64>,
    wind_kt: Option<f64>,
    wind_dir: Option<f64>,
    rh_pct: Option<f64>,
    vis_km: Option<f64>,
}

struct Level {
    hpa: f64,
    fl: f64,
    temp_c: Option<f64>,
    rh_pct: Option<f64>,
    wind_kt: Option<f64>,
    wind_dir: Option<f64>,
    height_m: Option<f64>,
}

fn surface_snapshot(hourly: &Value, index: usize) -> Snap {
    Snap {
        surface_temp_c: num_at(hourly, "temperature_2m", index),
        cloud_pct: num_at(hourly, "cloud_cover", index),
        precip_mm: num_at(hourly, "precipitation", index),
        weather_code: num_at(hourly, "weather_code", index),
        wind_kt: num_at(hourly, "wind_speed_10m", index).map(|value| js_round(value / 1.852)),
        wind_dir: num_at(hourly, "wind_direction_10m", index),
        rh_pct: num_at(hourly, "relative_humidity_2m", index),
        vis_km: num_at(hourly, "visibility", index)
            .map(|meters| js_round((meters / 1000.0) * 10.0) / 10.0),
    }
}

fn extract_levels(hourly: &Value, index: usize) -> Vec<Level> {
    LEVELS
        .iter()
        .map(|(hpa, fl)| Level {
            hpa: f64::from(*hpa),
            fl: *fl,
            temp_c: num_at(hourly, &format!("temperature_{hpa}hPa"), index),
            rh_pct: num_at(hourly, &format!("relative_humidity_{hpa}hPa"), index),
            wind_kt: num_at(hourly, &format!("wind_speed_{hpa}hPa"), index)
                .map(|value| js_round(value / 1.852)),
            wind_dir: num_at(hourly, &format!("wind_direction_{hpa}hPa"), index),
            height_m: num_at(hourly, &format!("geopotential_height_{hpa}hPa"), index),
        })
        .collect()
}

fn num_at(hourly: &Value, key: &str, index: usize) -> Option<f64> {
    let value = hourly.get(key)?.get(index)?;
    value.as_f64().filter(|number| number.is_finite())
}

fn time_strings(hourly: &Value) -> Vec<String> {
    hourly
        .get("time")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn as_single(value: &Value) -> Value {
    value
        .as_array()
        .and_then(|rows| rows.first())
        .cloned()
        .unwrap_or_else(|| value.clone())
}

fn as_list(value: &Value) -> Vec<Value> {
    value
        .as_array()
        .cloned()
        .unwrap_or_else(|| vec![value.clone()])
}

fn point_forecast(station: &Station, model: &str, response: &Value) -> Vec<u8> {
    let hourly = response.get("hourly").cloned().unwrap_or(Value::Null);
    let times = time_strings(&hourly);
    let hours: Vec<ForecastHour> = times
        .iter()
        .enumerate()
        .map(|(index, time)| {
            let snap = surface_snapshot(&hourly, index);
            ForecastHour {
                time: time.clone(),
                temp_c: snap.surface_temp_c,
                rh_pct: snap.rh_pct,
                precip_mm: snap.precip_mm,
                cloud_pct: snap.cloud_pct,
                wind_kt: snap.wind_kt,
                wind_dir: snap.wind_dir,
                vis_km: snap.vis_km,
                weather_code: snap.weather_code,
            }
        })
        .collect();
    let name = format!("{} / {}", station.city, station.name);
    forecast_json(
        station.icao,
        &name,
        model,
        response
            .get("latitude")
            .and_then(Value::as_f64)
            .unwrap_or(station.lat),
        response
            .get("longitude")
            .and_then(Value::as_f64)
            .unwrap_or(station.lon),
        response.get("elevation").and_then(Value::as_f64),
        &hours,
    )
}

fn pressure_hourly() -> String {
    let mut parts = Vec::new();
    for prefix in [
        "temperature",
        "relative_humidity",
        "wind_speed",
        "wind_direction",
        "geopotential_height",
    ] {
        let joined = LEVELS
            .iter()
            .map(|(hpa, _)| format!("{prefix}_{hpa}hPa"))
            .collect::<Vec<_>>()
            .join(",");
        parts.push(joined);
    }
    parts.extend([
        "temperature_2m".to_string(),
        "cloud_cover".to_string(),
        "precipitation".to_string(),
        "weather_code".to_string(),
    ]);
    parts.join(",")
}

fn pressure_url(lat: f64, lon: f64, days: u32) -> String {
    forecast_url(&[
        ("latitude", js_string(lat)),
        ("longitude", js_string(lon)),
        ("hourly", pressure_hourly()),
        ("forecast_days", days.to_string()),
        ("models", "gfs_seamless".to_string()),
        ("timezone", "UTC".to_string()),
    ])
}

fn pressure_url_multi(points: &[(f64, f64)], days: u32) -> String {
    let lats = points
        .iter()
        .map(|point| format!("{:.4}", point.0))
        .collect::<Vec<_>>()
        .join(",");
    let lons = points
        .iter()
        .map(|point| format!("{:.4}", point.1))
        .collect::<Vec<_>>()
        .join(",");
    forecast_url(&[
        ("latitude", lats),
        ("longitude", lons),
        ("hourly", pressure_hourly()),
        ("forecast_days", days.to_string()),
        ("models", "gfs_seamless".to_string()),
        ("timezone", "UTC".to_string()),
    ])
}

fn surface_url(lat: f64, lon: f64, days: u32) -> String {
    let hourly = [
        "temperature_2m",
        "relative_humidity_2m",
        "precipitation",
        "cloud_cover",
        "wind_speed_10m",
        "wind_direction_10m",
        "visibility",
        "weather_code",
    ]
    .join(",");
    forecast_url(&[
        ("latitude", js_string(lat)),
        ("longitude", js_string(lon)),
        ("hourly", hourly),
        ("forecast_days", days.to_string()),
        ("models", "gfs_seamless".to_string()),
        ("timezone", "UTC".to_string()),
    ])
}

fn forecast_url(params: &[(&str, String)]) -> String {
    let query = params
        .iter()
        .map(|(key, value)| format!("{}={}", url_encode(key), url_encode(value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("https://api.open-meteo.com/v1/forecast?{query}")
}

fn url_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => out.push(byte as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn js_string(value: f64) -> String {
    crate::js_json::format_js_number(value)
}

fn great_circle(lat1: f64, lon1: f64, lat2: f64, lon2: f64, steps: usize) -> Vec<(f64, f64)> {
    let to_rad = |degrees: f64| degrees * std::f64::consts::PI / 180.0;
    let to_deg = |radians: f64| radians * 180.0 / std::f64::consts::PI;
    let lat1_r = to_rad(lat1);
    let lon1_r = to_rad(lon1);
    let lat2_r = to_rad(lat2);
    let lon2_r = to_rad(lon2);
    let distance = to_rad(airfields::haversine_km(lat1, lon1, lat2, lon2) / 6371.0);
    let distance = if distance == 0.0 { 0.0001 } else { distance };
    let mut points = Vec::new();
    for index in 0..steps {
        let fraction = if steps == 1 {
            0.0
        } else {
            index as f64 / (steps as f64 - 1.0)
        };
        let weight_a = ((1.0 - fraction) * distance).sin() / distance.sin();
        let weight_b = (fraction * distance).sin() / distance.sin();
        let x = weight_a * lat1_r.cos() * lon1_r.cos() + weight_b * lat2_r.cos() * lon2_r.cos();
        let y = weight_a * lat1_r.cos() * lon1_r.sin() + weight_b * lat2_r.cos() * lon2_r.sin();
        let z = weight_a * lat1_r.sin() + weight_b * lat2_r.sin();
        let lat = z.atan2((x * x + y * y).sqrt());
        let lon = y.atan2(x);
        points.push((to_deg(lat), to_deg(lon)));
    }
    points
}

fn sigmet_in_fir(row: &Value, fir: &str) -> bool {
    let fir_id = row.get("firId").and_then(Value::as_str).unwrap_or("");
    let icao = row.get("icaoId").and_then(Value::as_str).unwrap_or("");
    if fir_id.starts_with("SC") || icao.starts_with("SC") {
        return true;
    }
    let Some(coords) = row.get("coords").and_then(Value::as_array) else {
        return false;
    };
    coords.iter().any(|coord| {
        let lat = coord.get("lat").and_then(Value::as_f64).unwrap_or(f64::NAN);
        let lon = coord.get("lon").and_then(Value::as_f64).unwrap_or(f64::NAN);
        in_chile(lat, lon) && in_fir(fir, lat)
    })
}

fn in_chile(lat: f64, lon: f64) -> bool {
    (-56.5..=-17.0).contains(&lat) && (-76.5..=-66.0).contains(&lon)
}

fn in_fir(fir: &str, lat: f64) -> bool {
    let (min, max) = match fir {
        "ANTOFAGASTA" => (-27.5, -17.0),
        "PUERTO_MONTT" => (-56.5, -38.5),
        _ => (-38.5, -27.5),
    };
    lat >= min && lat <= max
}

struct Sigmet {
    raw: Option<String>,
    hazard: Option<String>,
}

fn sigmet_list(rows: &[Value]) -> Vec<Sigmet> {
    rows.iter()
        .map(|row| Sigmet {
            raw: row
                .get("rawSigmet")
                .and_then(Value::as_str)
                .map(str::to_string),
            hazard: row
                .get("hazard")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
        .collect()
}

fn sigmet_json(sigmets: &[Sigmet]) -> Vec<Js<'_>> {
    sigmets
        .iter()
        .map(|sigmet| {
            Js::Obj(vec![
                ("raw", Js::Str(sigmet.raw.as_deref().unwrap_or(""))),
                ("hazard", opt_str(sigmet.hazard.as_deref())),
            ])
        })
        .collect()
}

fn sigmet_line(sigmet: &Sigmet) -> String {
    sigmet.raw.clone().unwrap_or_else(|| {
        sigmet
            .hazard
            .clone()
            .unwrap_or_else(|| "HAZARD".to_string())
    })
}

fn live_gamet_json(
    state: &AppState,
    fir: &stations::Fir,
    snap: &Snap,
    levels: &[Level],
    sigmets: &[Sigmet],
    _sigmet_down: bool,
) -> Vec<u8> {
    let fl050 = levels.iter().find(|level| level.hpa == 850.0);
    let fl100 = levels.iter().find(|level| level.hpa == 700.0);
    let fl180 = levels.iter().find(|level| level.hpa == 500.0);
    let freeze = levels
        .iter()
        .find(|level| level.temp_c.unwrap_or(99.0) <= 0.0);
    // Node `validFrom.setUTCMinutes(0, 0, 0)` floors to the UTC hour.
    let valid_from_ms = state.clock.now_ms().div_euclid(3_600_000) * 3_600_000;
    let valid_to_ms = valid_from_ms + 6 * 3_600_000;
    let valid_from = UtcStamp::from_epoch_ms(valid_from_ms).to_iso();
    let valid_to = UtcStamp::from_epoch_ms(valid_to_ms).to_iso();
    let icing = if levels.iter().any(|level| {
        level
            .temp_c
            .is_some_and(|temp| (-20.0..=0.0).contains(&temp))
            && level.rh_pct.unwrap_or(0.0) >= 70.0
    }) {
        "ICE: MOD possible in cloud near FZLVL"
    } else {
        "ICE: NIL significant"
    };
    let turb = if fl180.and_then(|level| level.wind_kt).unwrap_or(0.0)
        - fl050.and_then(|level| level.wind_kt).unwrap_or(0.0)
        > 35.0
    {
        "TURB: MOD possible ABV FL100 with speed shear"
    } else {
        "TURB: NIL significant"
    };
    let vis = match snap.vis_km {
        Some(km) if km < 5.0 => format!("SFC VIS: {km} KM"),
        _ => "SFC VIS: 10KM OR MORE".to_string(),
    };
    let cloud = match snap.cloud_pct.unwrap_or(0.0) {
        pct if pct >= 75.0 => "SIG CLOUD: BKN/OVC",
        pct if pct >= 40.0 => "SIG CLOUD: SCT/BKN",
        _ => "SIG CLOUD: FEW/SCT",
    };
    let sigmet_lines: Vec<String> = if sigmets.is_empty() {
        vec!["SIGMET: NIL current international SIGMET intersecting this FIR".to_string()]
    } else {
        sigmets.iter().map(sigmet_line).collect()
    };
    let section_i = {
        let mut lines = vec![
            format!(
                "SFC WIND: {}",
                format_wind(snap.wind_dir, snap.wind_kt, None)
            ),
            vis,
            cloud.to_string(),
            icing.to_string(),
            turb.to_string(),
        ];
        lines.extend(sigmet_lines);
        lines
    };
    let section_ii = vec![
        format!(
            "PSYS: GFS-derived field for {} (not an official DMC analysis)",
            fir.label
        ),
        format!(
            "WIND/T FL050: {} {}",
            format_wind(
                fl050.and_then(|level| level.wind_dir),
                fl050.and_then(|level| level.wind_kt),
                None
            ),
            format_temp(fl050.and_then(|level| level.temp_c))
        ),
        format!(
            "WIND/T FL100: {} {}",
            format_wind(
                fl100.and_then(|level| level.wind_dir),
                fl100.and_then(|level| level.wind_kt),
                None
            ),
            format_temp(fl100.and_then(|level| level.temp_c))
        ),
        format!(
            "WIND/T FL180: {} {}",
            format_wind(
                fl180.and_then(|level| level.wind_dir),
                fl180.and_then(|level| level.wind_kt),
                None
            ),
            format_temp(fl180.and_then(|level| level.temp_c))
        ),
        freeze
            .map(|level| format!("FZLVL: near FL{:03}", level.fl as i64))
            .unwrap_or_else(|| "FZLVL: ABV FL180".to_string()),
        format!(
            "CLD: {}% cover in the model grid",
            js_round(snap.cloud_pct.unwrap_or(0.0)) as i64
        ),
    ];
    let raw = format!(
        "{} GAMET VALID {} {}-\nSECN I\n{}\nSECN II\n{}\n=\n",
        fir.label.to_ascii_uppercase(),
        zulu_range(valid_from_ms, valid_to_ms),
        fir.icao_hint,
        section_i.join("\n"),
        section_ii.join("\n")
    );
    let section_i_json = string_list(&section_i);
    let section_ii_json = string_list(&section_ii);
    Js::Obj(vec![
        ("fir", Js::Str(fir.id)),
        ("firLabel", Js::Str(fir.label)),
        ("validFrom", Js::Str(&valid_from)),
        ("validTo", Js::Str(&valid_to)),
        ("raw", Js::Str(&raw)),
        ("sigmets", Js::Arr(sigmet_json(sigmets))),
        (
            "sections",
            Js::Arr(vec![
                Js::Obj(vec![
                    ("title", Js::Str("Section I — hazards for low-level flight")),
                    ("lines", Js::Arr(section_i_json)),
                ]),
                Js::Obj(vec![
                    ("title", Js::Str("Section II — additional information")),
                    ("lines", Js::Arr(section_ii_json)),
                ]),
            ]),
        ),
    ])
    .to_bytes()
}

fn string_list(lines: &[String]) -> Vec<Js<'_>> {
    lines.iter().map(|line| Js::Str(line)).collect()
}

fn zulu_range(from_ms: i64, to_ms: i64) -> String {
    fn fmt(ms: i64) -> String {
        let parts = UtcStamp::from_epoch_ms(ms).parts();
        format!("{:02}{:02}{:02}", parts.day, parts.hour, parts.minute)
    }
    format!("{}/{}", fmt(from_ms), fmt(to_ms))
}

fn format_wind(dir: Option<f64>, kt: Option<f64>, gust: Option<f64>) -> String {
    let Some(kt) = kt.filter(|value| value.is_finite()) else {
        return "—".to_string();
    };
    let gust_text = match gust {
        Some(gust) if gust != 0.0 && gust > kt => {
            format!("G{}", crate::js_json::format_js_number(gust))
        }
        _ => String::new(),
    };
    if kt == 0.0 {
        return "Calm".to_string();
    }
    let kt_text = crate::js_json::format_js_number(kt);
    match dir {
        None => format!("VRB / {kt_text} kt{gust_text}"),
        Some(dir) => {
            let rounded = js_round(dir) as i64;
            format!("{rounded:03}° / {kt_text} kt{gust_text}")
        }
    }
}

fn format_temp(celsius: Option<f64>) -> String {
    let Some(celsius) = celsius.filter(|value| value.is_finite()) else {
        return "—".to_string();
    };
    let rounded = js_round(celsius);
    let sign = if rounded > 0.0 { "+" } else { "" };
    format!("{sign}{} °C", crate::js_json::format_js_number(rounded))
}

fn fill_metar_name(parsed: &mut MetarObs, icao: &str) {
    if parsed.name.is_empty() {
        let station = stations::require_station(icao);
        parsed.name = format!("{} / {}", station.city, station.name);
    }
    if parsed.icao.is_empty() {
        parsed.icao = icao.to_string();
    }
}

fn fill_taf_name(parsed: &mut TafObs, icao: &str) {
    if parsed.name.is_empty() {
        let station = stations::require_station(icao);
        parsed.name = format!("{} / {}", station.city, station.name);
    }
    if parsed.icao.is_empty() {
        parsed.icao = icao.to_string();
    }
}

fn icao_param(query: Option<&str>) -> String {
    let map = query_map(query);
    map.get("icao")
        .or_else(|| map.get("ids"))
        .map(|value| {
            value
                .split(',')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_uppercase()
        })
        .unwrap_or_else(|| "SCEL".to_string())
}

fn product(
    state: &AppState,
    data: Vec<u8>,
    source: &str,
    label: &str,
    warning: Option<String>,
) -> Response {
    let fetched = state.clock.now_iso();
    let data_text = String::from_utf8(data).unwrap_or_default();
    let mut body = format!(
        "{{\"data\":{data_text},\"source\":{},\"sourceLabel\":{},\"fetchedAt\":{}",
        json_string(source),
        json_string(label),
        json_string(&fetched)
    );
    if let Some(warning) = warning {
        body.push_str(",\"warning\":");
        body.push_str(&json_string(&warning));
    }
    body.push('}');
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .expect("response")
}

fn json_string(value: &str) -> String {
    String::from_utf8(Js::Str(value).to_bytes()).expect("json string")
}

fn awc_gap(state: &AppState, code: &str, mock: Vec<u8>, mock_label: &str) -> Response {
    if state.dev_mock {
        return product(state, mock, "mock", mock_label, Some(code.to_string()));
    }
    observations_unavailable(state, code)
}

fn observations_unavailable(state: &AppState, code: &str) -> Response {
    let fetched = state.clock.now_iso();
    let body = Js::Obj(vec![
        ("data", Js::Null),
        ("source", Js::Str("unavailable")),
        ("sourceLabel", Js::Str("Observations unavailable")),
        ("fetchedAt", Js::Str(&fetched)),
        ("code", Js::Str(code)),
    ])
    .to_bytes();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .expect("response")
}

fn gateway(code: &str) -> Response {
    json_only(
        StatusCode::BAD_GATEWAY,
        crate::routes::upstream_unavailable(code),
    )
}

fn chart_failed(code: &str) -> Response {
    Response::builder()
        .status(StatusCode::BAD_GATEWAY)
        .header(header::CONTENT_TYPE, "text/plain;charset=UTF-8")
        .body(Body::from(format!("Chart unavailable ({code})")))
        .expect("response")
}

fn json_only(status: StatusCode, bytes: Vec<u8>) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(bytes))
        .expect("response")
}

fn metar_json(metar: &MetarObs) -> Vec<u8> {
    Js::Obj(vec![
        ("icao", Js::Str(&metar.icao)),
        ("name", Js::Str(&metar.name)),
        ("raw", Js::Str(&metar.raw)),
        ("observedAt", opt_str(metar.observed_at.as_deref())),
        ("tempC", js_opt_num(metar.temp_c)),
        ("dewpointC", js_opt_num(metar.dewpoint_c)),
        ("windDirDeg", js_opt_num(metar.wind_dir_deg)),
        ("windKt", js_opt_num(metar.wind_kt)),
        ("gustKt", js_opt_num(metar.gust_kt)),
        ("visM", js_opt_num(metar.vis_m)),
        ("altimeterHpa", js_opt_num(metar.altimeter_hpa)),
        ("flightCategory", Js::Str(&metar.flight_category)),
        ("cover", opt_str(metar.cover.as_deref())),
        ("clouds", clouds_json(&metar.clouds)),
        ("lat", Js::Num(metar.lat)),
        ("lon", Js::Num(metar.lon)),
        ("elevM", js_opt_num(metar.elev_m)),
    ])
    .to_bytes()
}

fn taf_json(taf: &TafObs) -> Vec<u8> {
    let periods = taf.periods.iter().map(period_json).collect();
    Js::Obj(vec![
        ("icao", Js::Str(&taf.icao)),
        ("name", Js::Str(&taf.name)),
        ("raw", Js::Str(&taf.raw)),
        ("issuedAt", opt_str(taf.issued_at.as_deref())),
        ("validFrom", opt_str(taf.valid_from.as_deref())),
        ("validTo", opt_str(taf.valid_to.as_deref())),
        ("periods", Js::Arr(periods)),
        ("lat", Js::Num(taf.lat)),
        ("lon", Js::Num(taf.lon)),
    ])
    .to_bytes()
}

fn period_json(period: &TafPeriod) -> Js<'_> {
    Js::Obj(vec![
        ("from", opt_str(period.from.as_deref())),
        ("to", opt_str(period.to.as_deref())),
        ("change", opt_str(period.change.as_deref())),
        ("probability", js_opt_num(period.probability)),
        ("windDirDeg", js_opt_num(period.wind_dir_deg)),
        ("windKt", js_opt_num(period.wind_kt)),
        ("visM", js_opt_num(period.vis_m)),
        ("wx", opt_str(period.wx.as_deref())),
        ("clouds", clouds_json(&period.clouds)),
        ("flightCategory", Js::Str(&period.flight_category)),
    ])
}

fn clouds_json(clouds: &[CloudLayer]) -> Js<'_> {
    Js::Arr(
        clouds
            .iter()
            .map(|cloud| {
                Js::Obj(vec![
                    ("cover", Js::Str(&cloud.cover)),
                    ("baseFt", js_opt_num(cloud.base_ft)),
                ])
            })
            .collect(),
    )
}

fn opt_str(value: Option<&str>) -> Js<'_> {
    match value {
        Some(text) => Js::Str(text),
        None => Js::Null,
    }
}

fn forecast_json(
    icao: &str,
    name: &str,
    model: &str,
    lat: f64,
    lon: f64,
    elev: Option<f64>,
    hours: &[ForecastHour],
) -> Vec<u8> {
    let hours_json = hours
        .iter()
        .map(|hour| {
            Js::Obj(vec![
                ("time", Js::Str(&hour.time)),
                ("tempC", js_opt_num(hour.temp_c)),
                ("rhPct", js_opt_num(hour.rh_pct)),
                ("precipMm", js_opt_num(hour.precip_mm)),
                ("cloudPct", js_opt_num(hour.cloud_pct)),
                ("windKt", js_opt_num(hour.wind_kt)),
                ("windDirDeg", js_opt_num(hour.wind_dir)),
                ("visKm", js_opt_num(hour.vis_km)),
                ("weatherCode", js_opt_num(hour.weather_code)),
            ])
        })
        .collect();
    Js::Obj(vec![
        ("icao", Js::Str(icao)),
        ("name", Js::Str(name)),
        ("model", Js::Str(model)),
        ("lat", Js::Num(lat)),
        ("lon", Js::Num(lon)),
        ("elevM", js_opt_num(elev)),
        ("hours", Js::Arr(hours_json)),
    ])
    .to_bytes()
}

fn column_json<'a>(
    km: f64,
    lat: f64,
    lon: f64,
    label: Option<&'a str>,
    snap: &Snap,
    levels: &'a [Level],
) -> Js<'a> {
    let levels_json: Vec<Js<'static>> = levels.iter().map(level_json).collect();
    let mut fields = vec![
        ("km", Js::Num(km)),
        ("lat", Js::Num(lat)),
        ("lon", Js::Num(lon)),
    ];
    if let Some(label) = label {
        fields.push(("label", Js::Str(label)));
    }
    fields.extend([
        ("surfaceTempC", js_opt_num(snap.surface_temp_c)),
        ("cloudPct", js_opt_num(snap.cloud_pct)),
        ("precipMm", js_opt_num(snap.precip_mm)),
        ("weatherCode", js_opt_num(snap.weather_code)),
        ("levels", Js::Arr(levels_json)),
    ]);
    Js::Obj(fields)
}

fn level_json(level: &Level) -> Js<'static> {
    Js::Obj(vec![
        ("hpa", Js::Num(level.hpa)),
        ("flApprox", Js::Num(level.fl)),
        ("tempC", js_opt_num(level.temp_c)),
        ("rhPct", js_opt_num(level.rh_pct)),
        ("windKt", js_opt_num(level.wind_kt)),
        ("windDirDeg", js_opt_num(level.wind_dir)),
        ("heightM", js_opt_num(level.height_m)),
    ])
}

fn viz_station_json<'a>(
    station: &'a Station,
    metar: Option<&MetarObs>,
    category: &'a str,
    cloud: Option<f64>,
    precip: Option<f64>,
    levels: &'a [Level],
) -> Js<'a> {
    Js::Obj(vec![
        ("icao", Js::Str(station.icao)),
        ("name", Js::Str(station.city)),
        ("lat", Js::Num(station.lat)),
        ("lon", Js::Num(station.lon)),
        ("elevM", Js::Num(station.elev_m)),
        ("flightCategory", Js::Str(category)),
        ("tempC", js_opt_num(metar.and_then(|item| item.temp_c))),
        ("windKt", js_opt_num(metar.and_then(|item| item.wind_kt))),
        (
            "windDirDeg",
            js_opt_num(metar.and_then(|item| item.wind_dir_deg)),
        ),
        ("cloudPct", js_opt_num(cloud)),
        ("precipMm", js_opt_num(precip)),
        ("levels", Js::Arr(levels.iter().map(level_json).collect())),
    ])
}

fn iso_shift(now_ms: i64, hours: f64) -> String {
    let ms = (now_ms as f64 + hours * 3_600_000.0).trunc() as i64;
    UtcStamp::from_epoch_ms(ms).to_iso()
}

fn zulu_now(now_ms: i64) -> String {
    let parts = UtcStamp::from_epoch_ms(now_ms).parts();
    let minute = (parts.minute / 30) * 30;
    format!("{:02}{:02}{:02}Z", parts.day, parts.hour, minute)
}

fn mock_metar_json(state: &AppState, icao: &str) -> Vec<u8> {
    let station = stations::require_station(icao);
    let now = state.clock.now_ms();
    let zulu = zulu_now(now);
    let raw = format!(
        "METAR {} {zulu} 18008KT 9999 FEW040 SCT100 16/08 Q1016 NOSIG",
        station.icao
    );
    let name = format!("{} / {}", station.city, station.name);
    let observed = iso_shift(now, -0.4);
    Js::Obj(vec![
        ("icao", Js::Str(station.icao)),
        ("name", Js::Str(&name)),
        ("raw", Js::Str(&raw)),
        ("observedAt", Js::Str(&observed)),
        ("tempC", Js::Num(16.0)),
        ("dewpointC", Js::Num(8.0)),
        ("windDirDeg", Js::Num(180.0)),
        ("windKt", Js::Num(8.0)),
        ("gustKt", Js::Null),
        ("visM", Js::Num(9999.0)),
        ("altimeterHpa", Js::Num(1016.0)),
        ("flightCategory", Js::Str("VFR")),
        ("cover", Js::Str("SCT")),
        (
            "clouds",
            Js::Arr(vec![
                Js::Obj(vec![("cover", Js::Str("FEW")), ("baseFt", Js::Num(4000.0))]),
                Js::Obj(vec![
                    ("cover", Js::Str("SCT")),
                    ("baseFt", Js::Num(10000.0)),
                ]),
            ]),
        ),
        ("lat", Js::Num(station.lat)),
        ("lon", Js::Num(station.lon)),
        ("elevM", Js::Num(station.elev_m)),
    ])
    .to_bytes()
}

fn mock_taf_json(state: &AppState, icao: &str) -> Vec<u8> {
    let station = stations::require_station(icao);
    let now = state.clock.now_ms();
    let zulu = zulu_now(now);
    let day = &zulu[..2];
    let raw = format!(
        "TAF {} {zulu} {day}00/{day}24 18010KT 9999 FEW050 SCT120 TX23/19Z TN08/10Z BECMG 0204 13004KT SCT140 TEMPO 0813 4000 BR NSC",
        station.icao
    );
    let name = format!("{} / {}", station.city, station.name);
    let from = iso_shift(now, -2.0);
    let to = iso_shift(now, 22.0);
    let issued = iso_shift(now, -3.0);
    let becmg_from = iso_shift(now, 4.0);
    let becmg_to = iso_shift(now, 10.0);
    let tempo_from = iso_shift(now, 10.0);
    let tempo_to = iso_shift(now, 16.0);
    Js::Obj(vec![
        ("icao", Js::Str(station.icao)),
        ("name", Js::Str(&name)),
        ("raw", Js::Str(&raw)),
        ("issuedAt", Js::Str(&issued)),
        ("validFrom", Js::Str(&from)),
        ("validTo", Js::Str(&to)),
        ("lat", Js::Num(station.lat)),
        ("lon", Js::Num(station.lon)),
        (
            "periods",
            Js::Arr(vec![
                period_owned(
                    &from,
                    &becmg_from,
                    None,
                    Some(180.0),
                    Some(10.0),
                    Some(9999.0),
                    None,
                    &[("FEW", Some(5000.0)), ("SCT", Some(12000.0))],
                    "VFR",
                ),
                period_owned(
                    &becmg_from,
                    &becmg_to,
                    Some("BECMG"),
                    Some(130.0),
                    Some(4.0),
                    Some(9999.0),
                    None,
                    &[("SCT", Some(14000.0))],
                    "VFR",
                ),
                period_owned(
                    &tempo_from,
                    &tempo_to,
                    Some("TEMPO"),
                    None,
                    None,
                    Some(4000.0),
                    Some("BR"),
                    &[("NSC", None)],
                    "IFR",
                ),
            ]),
        ),
    ])
    .to_bytes()
}

#[allow(clippy::too_many_arguments)]
fn period_owned<'a>(
    from: &'a str,
    to: &'a str,
    change: Option<&'a str>,
    dir: Option<f64>,
    kt: Option<f64>,
    vis: Option<f64>,
    wx: Option<&'a str>,
    clouds: &'a [(&'a str, Option<f64>)],
    category: &'a str,
) -> Js<'a> {
    Js::Obj(vec![
        ("from", Js::Str(from)),
        ("to", Js::Str(to)),
        ("change", opt_str(change)),
        ("probability", Js::Null),
        ("windDirDeg", js_opt_num(dir)),
        ("windKt", js_opt_num(kt)),
        ("visM", js_opt_num(vis)),
        ("wx", opt_str(wx)),
        (
            "clouds",
            Js::Arr(
                clouds
                    .iter()
                    .map(|(cover, base)| {
                        Js::Obj(vec![
                            ("cover", Js::Str(cover)),
                            ("baseFt", js_opt_num(*base)),
                        ])
                    })
                    .collect(),
            ),
        ),
        ("flightCategory", Js::Str(category)),
    ])
}

fn mock_levels(base_temp: f64) -> Vec<Level> {
    let lapse = [0.0, 4.0, 8.0, 16.0, 32.0, 48.0];
    let rh = [62.0, 58.0, 48.0, 40.0, 35.0, 28.0];
    let wind = [8.0, 12.0, 18.0, 32.0, 48.0, 62.0];
    let dir = [180.0, 190.0, 210.0, 230.0, 250.0, 260.0];
    let height = [110.0, 760.0, 1480.0, 3010.0, 5680.0, 9180.0];
    LEVELS
        .iter()
        .enumerate()
        .map(|(index, (hpa, fl))| Level {
            hpa: f64::from(*hpa),
            fl: *fl,
            temp_c: Some(js_round((base_temp - lapse[index]) * 10.0) / 10.0),
            rh_pct: Some(rh[index]),
            wind_kt: Some(wind[index]),
            wind_dir: Some(dir[index]),
            height_m: Some(height[index]),
        })
        .collect()
}

fn mock_gramet_json(state: &AppState, from: &Station, to: &Station) -> Vec<u8> {
    let mut snaps = Vec::new();
    let mut level_rows = Vec::new();
    for index in 0..6 {
        snaps.push(Snap {
            surface_temp_c: Some(16.0 - index as f64 * 1.2),
            cloud_pct: Some(20.0 + index as f64 * 12.0),
            precip_mm: Some(if index > 3 { 0.4 } else { 0.0 }),
            weather_code: Some(if index > 3 { 51.0 } else { 2.0 }),
            wind_kt: None,
            wind_dir: None,
            rh_pct: None,
            vis_km: None,
        });
        level_rows.push(mock_levels(16.0 - index as f64));
    }
    let columns: Vec<Js<'_>> = (0..6)
        .map(|index| {
            let t = index as f64 / 5.0;
            let label = if index == 0 {
                Some(from.icao)
            } else if index == 5 {
                Some(to.icao)
            } else {
                None
            };
            column_json(
                js_round(t * 910.0),
                from.lat + (to.lat - from.lat) * t,
                from.lon + (to.lon - from.lon) * t,
                label,
                &snaps[index],
                &level_rows[index],
            )
        })
        .collect();
    let valid = state.clock.now_iso();
    Js::Obj(vec![
        ("fromIcao", Js::Str(from.icao)),
        ("toIcao", Js::Str(to.icao)),
        ("fromName", Js::Str(from.city)),
        ("toName", Js::Str(to.city)),
        ("validTime", Js::Str(&valid)),
        ("distanceKm", Js::Num(910.0)),
        ("columns", Js::Arr(columns)),
    ])
    .to_bytes()
}

fn mock_gamet_json(state: &AppState, fir: &stations::Fir, sigmets: &[Sigmet]) -> Vec<u8> {
    let now = state.clock.now_ms();
    let zulu = zulu_now(now);
    let day = &zulu[..2];
    let raw = format!(
        "{label} GAMET VALID {zulu}/{day}1200 SCEL-
SECN I
SFC WIND: 10/18KT
SFC VIS: 8KM BR IN VALLEYS TIL 12Z
SIG CLOUD: BKN 040/100 ANDES
ICE: MOD FZLVL 11000FT
TURB: MOD ABV 080 ANDES
SIGMET: NIL
SECN II
PSYS: TROUGH OVER SCTE MOV E 15KT
WIND/T: 2000FT 180/12KT PS12 5000FT 210/18KT PS06 10000FT 240/32KT MS02
CLD: FEW/SCT CU 040/100
FZLVL: 11000FT
MNM QNH: 1012 HPA
=",
        label = fir.label
    );
    let from = iso_shift(now, 0.0);
    let to = iso_shift(now, 6.0);
    let section_i = [
        "SFC WIND: 10/18 KT, locally 22 KT on the coast",
        "SFC VIS: 8 KM, BR in Central Valley until 12Z",
        "SIG CLOUD: BKN 040/100 along the Andes",
        "ICE: MOD in cloud, freezing level 11 000 ft",
        "TURB: MOD above 8 000 ft over the Andes",
        "SIGMET: NIL in this mock bulletin",
    ];
    let section_ii = [
        "PSYS: trough near Puerto Montt moving east 15 KT",
        "WIND/T 2 000 ft: 180/12 KT +12",
        "WIND/T 5 000 ft: 210/18 KT +06",
        "WIND/T 10 000 ft: 240/32 KT −02",
        "CLD: FEW/SCT CU 040/100",
        "FZLVL: 11 000 ft",
        "MNM QNH: 1012 hPa",
    ];
    Js::Obj(vec![
        ("fir", Js::Str(fir.id)),
        ("firLabel", Js::Str(fir.label)),
        ("validFrom", Js::Str(&from)),
        ("validTo", Js::Str(&to)),
        ("raw", Js::Str(&raw)),
        ("sigmets", Js::Arr(sigmet_json(sigmets))),
        (
            "sections",
            Js::Arr(vec![
                Js::Obj(vec![
                    ("title", Js::Str("Section I — hazards for low-level flight")),
                    (
                        "lines",
                        Js::Arr(section_i.into_iter().map(Js::Str).collect()),
                    ),
                ]),
                Js::Obj(vec![
                    ("title", Js::Str("Section II — additional information")),
                    (
                        "lines",
                        Js::Arr(section_ii.into_iter().map(Js::Str).collect()),
                    ),
                ]),
            ]),
        ),
    ])
    .to_bytes()
}

fn mock_forecast_json(state: &AppState, station: &Station) -> Vec<u8> {
    let now = state.clock.now_ms();
    let hour = UtcStamp::from_epoch_ms(now).parts().hour as f64;
    let hours: Vec<ForecastHour> = (0..48)
        .map(|index| {
            let diurnal = (((index as f64 % 24.0) - 6.0) / 24.0 * std::f64::consts::PI * 2.0).sin();
            ForecastHour {
                time: iso_shift(now, index as f64 - hour),
                temp_c: Some(js_round((14.0 + diurnal * 7.0) * 10.0) / 10.0),
                rh_pct: Some(js_round(70.0 - diurnal * 20.0)),
                precip_mm: Some(if index % 17 == 0 { 0.6 } else { 0.0 }),
                cloud_pct: Some(40.0 + (index % 5) as f64 * 8.0),
                wind_kt: Some(6.0 + (index % 4) as f64),
                wind_dir: Some(180.0 + (index % 6) as f64 * 5.0),
                vis_km: Some(10.0),
                weather_code: Some(if index % 17 == 0 { 51.0 } else { 2.0 }),
            }
        })
        .collect();
    let name = format!("{} / {}", station.city, station.name);
    forecast_json(
        station.icao,
        &name,
        "Mock WRF-style (offline)",
        station.lat,
        station.lon,
        Some(station.elev_m),
        &hours,
    )
}

fn mock_viz_json() -> Vec<u8> {
    let icaos = ["SCAR", "SCFA", "SCEL", "SCIE", "SCTE", "SCCI"];
    let levels = mock_levels(14.0);
    let stations_json = icaos
        .into_iter()
        .map(|icao| {
            let station = stations::require_station(icao);
            Js::Obj(vec![
                ("icao", Js::Str(station.icao)),
                ("name", Js::Str(station.city)),
                ("lat", Js::Num(station.lat)),
                ("lon", Js::Num(station.lon)),
                ("elevM", Js::Num(station.elev_m)),
                (
                    "flightCategory",
                    Js::Str(if icao == "SCTE" { "MVFR" } else { "VFR" }),
                ),
                ("tempC", Js::Num(14.0)),
                ("windKt", Js::Num(10.0)),
                ("windDirDeg", Js::Num(200.0)),
                ("cloudPct", Js::Num(45.0)),
                ("precipMm", Js::Num(0.0)),
                ("levels", Js::Arr(levels.iter().map(level_json).collect())),
            ])
        })
        .collect();
    Js::Arr(stations_json).to_bytes()
}

fn synoptic_json() -> Vec<u8> {
    let products = [
        (
            "sam-00",
            "South America surface 00Z",
            "00Z",
            "NOAA WPC International Desk surface analysis for the continent, 00 UTC.",
            "/api/synoptic/image?id=sam-00",
        ),
        (
            "sam-06",
            "South America surface 06Z",
            "06Z",
            "NOAA WPC surface analysis, 06 UTC.",
            "/api/synoptic/image?id=sam-06",
        ),
        (
            "sam-12",
            "South America surface 12Z",
            "12Z",
            "NOAA WPC surface analysis, 12 UTC.",
            "/api/synoptic/image?id=sam-12",
        ),
        (
            "sam-18",
            "South America surface 18Z",
            "18Z",
            "NOAA WPC surface analysis, 18 UTC.",
            "/api/synoptic/image?id=sam-18",
        ),
        (
            "sam-d1",
            "South America day-1 forecast",
            "D+1",
            "WPC South American desk color surface forecast, day 1.",
            "/api/synoptic/image?id=sam-d1",
        ),
        (
            "sam-d2",
            "South America day-2 forecast",
            "D+2",
            "WPC South American desk color surface forecast, day 2.",
            "/api/synoptic/image?id=sam-d2",
        ),
    ];
    Js::Arr(
        products
            .into_iter()
            .map(|(id, title, cycle, description, image)| {
                Js::Obj(vec![
                    ("id", Js::Str(id)),
                    ("title", Js::Str(title)),
                    ("cycle", Js::Str(cycle)),
                    ("description", Js::Str(description)),
                    ("imagePath", Js::Str(image)),
                    ("origin", Js::Str(synoptic_origin(id).unwrap_or(""))),
                ])
            })
            .collect(),
    )
    .to_bytes()
}

fn synoptic_origin(id: &str) -> Option<&'static str> {
    Some(match id {
        "sam-00" => "https://www.wpc.ncep.noaa.gov/international/sampssfc00.gif",
        "sam-06" => "https://www.wpc.ncep.noaa.gov/international/sampssfc06.gif",
        "sam-12" => "https://www.wpc.ncep.noaa.gov/international/sampssfc12.gif",
        "sam-18" => "https://www.wpc.ncep.noaa.gov/international/sampssfc18.gif",
        "sam-d1" => "https://www.wpc.ncep.noaa.gov/international/d1.gif",
        "sam-d2" => "https://www.wpc.ncep.noaa.gov/international/d2.gif",
        _ => return None,
    })
}
