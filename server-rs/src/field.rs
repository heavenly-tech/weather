//! Point, probe, and grid fetches on top of the Open-Meteo cache.

use std::collections::HashMap;

use serde_json::Value;
use tokio::sync::Mutex;

use crate::cache::{batch_delay_ms, batch_size, OpenMeteoCache};
use crate::ceiling::ceiling_from_hourly;
use crate::domain::{self, GridPoint};
use crate::models::{self, ModelMeta, ANDES_MODELS};
use crate::regrid::{refine_ceiling_grid, CoarseSample};
use crate::series::Series;
use crate::utc::parse_utc_iso;

#[derive(Clone, Debug)]
pub struct PointFetch {
    pub ok: bool,
    pub hourly: Value,
    pub elev_m: f64,
    pub times: Vec<String>,
    pub error: String,
    /// Short reason for a 502. Empty when the fetch succeeded.
    pub code: String,
    pub meta: Option<ModelMeta>,
}

pub async fn fetch_point_hourly(
    cache: &OpenMeteoCache,
    model: &str,
    lat: f64,
    lon: f64,
    forecast_hours: u32,
    past_hours: u32,
) -> PointFetch {
    let Some(meta) = models::model_by_id(model).copied() else {
        return PointFetch {
            ok: false,
            hourly: Value::Null,
            elev_m: 0.0,
            times: Vec::new(),
            error: "Unknown model".to_string(),
            code: "unknown-model".to_string(),
            meta: None,
        };
    };
    let url = models::open_meteo_forecast_url(lat, lon, model, forecast_hours, past_hours);
    let response = match cache.cached_fetch(&url, Some(model)).await {
        Ok(response) => response,
        Err(_error) => {
            return PointFetch {
                ok: false,
                hourly: Value::Null,
                elev_m: 0.0,
                times: Vec::new(),
                error: "Upstream unavailable (transport)".to_string(),
                code: "transport".to_string(),
                meta: Some(meta),
            };
        }
    };
    if response.status != 200 {
        return PointFetch {
            ok: false,
            hourly: Value::Null,
            elev_m: 0.0,
            times: Vec::new(),
            error: format!("HTTP {}", response.status),
            code: format!("http-{}", response.status),
            meta: Some(meta),
        };
    }
    let parsed = match serde_json::from_str::<Value>(&response.body) {
        Ok(value) => value,
        Err(_error) => {
            return PointFetch {
                ok: false,
                hourly: Value::Null,
                elev_m: 0.0,
                times: Vec::new(),
                error: "Upstream unavailable (bad-json)".to_string(),
                code: "bad-json".to_string(),
                meta: Some(meta),
            };
        }
    };
    let body = as_single(&parsed);
    let hourly = body.get("hourly").cloned().unwrap_or(Value::Null);
    let elev_m = body.get("elevation").and_then(Value::as_f64).unwrap_or(0.0);
    PointFetch {
        ok: true,
        times: time_strings(&hourly),
        hourly,
        elev_m,
        error: String::new(),
        code: String::new(),
        meta: Some(meta),
    }
}

pub async fn fetch_multi(
    cache: &OpenMeteoCache,
    points: &[GridPoint],
    model: &str,
) -> Result<Vec<Value>, String> {
    let size = batch_size().max(1);
    let mut list = Vec::new();
    let mut index = 0;
    let mut batch_index = 0;
    let batch_count = points.len().div_ceil(size);
    while index < points.len() {
        let end = (index + size).min(points.len());
        let pairs: Vec<(f64, f64)> = points[index..end]
            .iter()
            .map(|point| (point.lat, point.lon))
            .collect();
        let url = models::open_meteo_multi_url(&pairs, model);
        let mut response = cache
            .cached_fetch(&url, Some(model))
            .await
            .map_err(|_| "Upstream unavailable (transport)".to_string())?;
        if response.status == 429 {
            (cache.sleep)(batch_delay_ms().saturating_mul(4)).await;
            response = cache
                .cached_fetch(&url, Some(model))
                .await
                .map_err(|_| "Upstream unavailable (transport)".to_string())?;
        }
        if response.status != 200 {
            return Err(format!("Upstream unavailable (http-{})", response.status));
        }
        let parsed: Value = serde_json::from_str(&response.body)
            .map_err(|_| "Upstream unavailable (bad-json)".to_string())?;
        list.extend(as_list(&parsed));
        index = end;
        batch_index += 1;
        if batch_index < batch_count {
            (cache.sleep)(batch_delay_ms()).await;
        }
    }
    Ok(list)
}

pub struct CeilingGrid {
    pub cells: crate::regrid::FineGrid,
    pub model_run: Option<String>,
    pub coarse_rows: usize,
    pub coarse_cols: usize,
    pub times: Vec<String>,
    pub unavailable: Option<String>,
}

pub async fn fetch_ceiling_grid(
    cache: &OpenMeteoCache,
    model: &str,
    valid_ms: i64,
) -> Result<CeilingGrid, String> {
    let (coarse_rows, coarse_cols) = domain::default_grid_shape();
    if models::model_by_id(model).is_none() {
        return Ok(empty_grid(coarse_rows, coarse_cols, "Unknown model"));
    }
    let grid = domain::domain_grid(coarse_rows, coarse_cols);
    let list = match fetch_multi(cache, &grid, model).await {
        Ok(list) => list,
        Err(error) => return Ok(empty_grid(coarse_rows, coarse_cols, &error)),
    };
    let mut samples = Vec::new();
    for (idx, point) in list.iter().enumerate() {
        let hourly = point.get("hourly").cloned().unwrap_or(Value::Null);
        let series = Series::from_json(&hourly);
        let times = time_strings(&hourly);
        let index = pick_hour_index(&times, valid_ms);
        let elev_m = point
            .get("elevation")
            .and_then(Value::as_f64)
            .or_else(|| grid.get(idx).map(|_| 0.0))
            .unwrap_or(0.0);
        let sample = ceiling_from_hourly(&series.hourly, index, elev_m);
        samples.push(CoarseSample {
            lat: point.get("latitude").and_then(Value::as_f64).unwrap_or(0.0),
            lon: point
                .get("longitude")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            base_msl_m: sample.cloud_base_msl_m,
            obscured: sample.obscured,
            low_cloud_unresolved: sample.low_cloud_unresolved,
            precip_mm_h: Some(liquid_precip(&hourly, index)),
        });
    }
    let refined = refine_ceiling_grid(&samples, coarse_rows, coarse_cols)?;
    let times = list
        .first()
        .map(|point| time_strings(point.get("hourly").unwrap_or(&Value::Null)))
        .unwrap_or_default();
    let index = pick_hour_index(&times, valid_ms);
    let model_run = times.get(index).cloned();
    Ok(CeilingGrid {
        cells: refined,
        model_run,
        coarse_rows,
        coarse_cols,
        times,
        unavailable: None,
    })
}

fn empty_grid(rows: usize, cols: usize, reason: &str) -> CeilingGrid {
    CeilingGrid {
        cells: crate::regrid::FineGrid {
            cells: Vec::new(),
            rows: 0,
            cols: 0,
        },
        model_run: None,
        coarse_rows: rows,
        coarse_cols: cols,
        times: Vec::new(),
        unavailable: Some(reason.to_string()),
    }
}

#[derive(Clone, Debug)]
pub struct ModelAvailability {
    pub id: &'static str,
    pub label: &'static str,
    pub available: bool,
    pub warning: Option<String>,
}

pub struct ProbeCache {
    inner: Mutex<HashMap<String, (i64, Vec<ModelAvailability>)>>,
}

impl Default for ProbeCache {
    fn default() -> Self {
        Self::new()
    }
}

impl ProbeCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub async fn probe(
        &self,
        cache: &OpenMeteoCache,
        lat: f64,
        lon: f64,
        now_ms: i64,
    ) -> Vec<ModelAvailability> {
        let key = format!("{lat:.3},{lon:.3}");
        let guard = self.inner.lock().await;
        if let Some((at, data)) = guard.get(&key) {
            if now_ms - *at < 15 * 60 * 1000 {
                return data.clone();
            }
        }
        drop(guard);
        let data = probe_models(cache, lat, lon).await;
        self.inner.lock().await.insert(key, (now_ms, data.clone()));
        data
    }
}

pub async fn probe_models(cache: &OpenMeteoCache, lat: f64, lon: f64) -> Vec<ModelAvailability> {
    let mut out = Vec::new();
    for meta in ANDES_MODELS {
        let url = models::open_meteo_forecast_url(lat, lon, meta.id, 1, 0);
        let response = match cache.cached_fetch(&url, Some(meta.id)).await {
            Ok(response) => response,
            Err(_error) => {
                out.push(ModelAvailability {
                    id: meta.id,
                    label: meta.label,
                    available: false,
                    warning: Some("Upstream unavailable (transport)".to_string()),
                });
                continue;
            }
        };
        if response.status != 200 {
            out.push(ModelAvailability {
                id: meta.id,
                label: meta.label,
                available: false,
                warning: Some(format!("Upstream unavailable (http-{})", response.status)),
            });
            continue;
        }
        let parsed = serde_json::from_str::<Value>(&response.body).unwrap_or(Value::Null);
        let hourly = as_single(&parsed)
            .get("hourly")
            .cloned()
            .unwrap_or(Value::Null);
        let has_level = match hourly.get("cloud_cover_850hPa") {
            Some(Value::Array(_)) => true,
            Some(Value::Null) | None => false,
            Some(_) => true,
        };
        // Boolean(hourly.cloud_cover_850hPa): an array is truthy even if empty.
        // A missing key is undefined, which is falsy.
        out.push(ModelAvailability {
            id: meta.id,
            label: meta.label,
            available: has_level,
            warning: if has_level {
                None
            } else {
                Some("Pressure-level cloud cover missing".to_string())
            },
        });
    }
    out
}

pub fn slice_at_pressure(
    hourly: &Value,
    index: usize,
    pressure_hpa: f64,
) -> (Option<f64>, Option<f64>) {
    let key_temp = format!("temperature_{pressure_hpa}hPa");
    let key_cloud = format!("cloud_cover_{pressure_hpa}hPa");
    (
        number_at(hourly, &key_temp, index),
        number_at(hourly, &key_cloud, index),
    )
}

fn number_at(hourly: &Value, key: &str, index: usize) -> Option<f64> {
    match hourly
        .get(key)
        .and_then(Value::as_array)
        .and_then(|items| items.get(index))
    {
        Some(Value::Number(number)) => number.as_f64(),
        _ => None,
    }
}

pub fn liquid_precip(hourly: &Value, index: usize) -> f64 {
    fn read(hourly: &Value, key: &str, index: usize) -> f64 {
        match number_at(hourly, key, index) {
            Some(value) if value.is_finite() => value,
            _ => 0.0,
        }
    }
    read(hourly, "precipitation", index)
        .max(read(hourly, "rain", index))
        .max(read(hourly, "showers", index))
}

pub fn pick_hour_index(times: &[String], target_ms: i64) -> usize {
    if times.is_empty() {
        return 0;
    }
    let mut best = 0;
    let mut best_diff = i64::MAX;
    for (index, iso) in times.iter().enumerate() {
        let normalized = if iso.ends_with('Z') {
            iso.clone()
        } else {
            format!("{iso}Z")
        };
        let Ok(stamp) = parse_utc_iso(&normalized) else {
            continue;
        };
        let diff = (stamp.epoch_ms() - target_ms).saturating_abs();
        if diff < best_diff {
            best = index;
            best_diff = diff;
        }
    }
    best
}

pub fn time_strings(hourly: &Value) -> Vec<String> {
    hourly
        .get("time")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| item.as_str().unwrap_or("").to_string())
                .collect()
        })
        .unwrap_or_default()
}

pub fn as_single(value: &Value) -> Value {
    match value.as_array() {
        Some(items) => items.first().cloned().unwrap_or(Value::Null),
        None => value.clone(),
    }
}

pub fn as_list(value: &Value) -> Vec<Value> {
    match value.as_array() {
        Some(items) => items.clone(),
        None => vec![value.clone()],
    }
}
