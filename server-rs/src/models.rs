//! Open-Meteo model ids and the URL builders.
//!
//! Query order is the cache key. `URLSearchParams` percent-encodes commas and
//! leaves the parameter order of the object literal.

pub const FORECAST_ORIGIN: &str = "https://api.open-meteo.com/v1/forecast";

pub const ANDES_MODELS: &[ModelMeta] = &[
    ModelMeta {
        id: "gfs_seamless",
        label: "GFS",
        query: "gfs_seamless",
        cloud_base_field: None,
    },
    ModelMeta {
        id: "ecmwf_ifs025",
        label: "ECMWF IFS 0.25°",
        query: "ecmwf_ifs025",
        cloud_base_field: None,
    },
    ModelMeta {
        id: "icon_seamless",
        label: "DWD ICON",
        query: "icon_seamless",
        cloud_base_field: Some("convective_cloud_base"),
    },
    ModelMeta {
        id: "gem_seamless",
        label: "GEM",
        query: "gem_seamless",
        cloud_base_field: None,
    },
];

const GRID_LEVELS: &[u16] = &[950, 925, 900, 850, 800, 700];
const POINT_LEVELS: &[u16] = &[1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];

#[derive(Clone, Copy, Debug)]
pub struct ModelMeta {
    pub id: &'static str,
    pub label: &'static str,
    pub query: &'static str,
    pub cloud_base_field: Option<&'static str>,
}

pub fn parse_andes_model_id(raw: Option<&str>) -> Option<&'static str> {
    let id = raw.unwrap_or("gfs_seamless");
    ANDES_MODELS
        .iter()
        .find(|model| model.id == id)
        .map(|model| model.id)
}

pub fn model_by_id(id: &str) -> Option<&'static ModelMeta> {
    ANDES_MODELS.iter().find(|model| model.id == id)
}

pub fn open_meteo_forecast_url(
    lat: f64,
    lon: f64,
    model: &str,
    forecast_hours: u32,
    past_hours: u32,
) -> String {
    let meta = model_by_id(model).expect("caller checks the model id");
    let mut params = Vec::new();
    params.push(("latitude", js_number(lat)));
    params.push(("longitude", js_number(lon)));
    params.push(("hourly", hourly_variables(meta)));
    params.push(("forecast_hours", forecast_hours.to_string()));
    params.push(("past_hours", past_hours.to_string()));
    params.push(("models", meta.query.to_string()));
    params.push(("timezone", "UTC".to_string()));
    format!("{FORECAST_ORIGIN}?{}", form_query(&params))
}

pub fn open_meteo_multi_url(points: &[(f64, f64)], model: &str) -> String {
    let meta = model_by_id(model).expect("caller checks the model id");
    let mut hourly = Vec::new();
    for hpa in GRID_LEVELS {
        hourly.push(format!("cloud_cover_{hpa}hPa"));
    }
    for hpa in GRID_LEVELS {
        hourly.push(format!("geopotential_height_{hpa}hPa"));
    }
    hourly.extend([
        "surface_pressure".to_string(),
        "precipitation".to_string(),
        "rain".to_string(),
        "showers".to_string(),
    ]);
    if model == "icon_seamless" {
        hourly.push("convective_cloud_base".to_string());
        hourly.push("cloud_cover_low".to_string());
    } else {
        hourly.push("cloud_cover_low".to_string());
    }
    let lats = points
        .iter()
        .map(|(lat, _)| format!("{lat:.4}"))
        .collect::<Vec<_>>()
        .join(",");
    let lons = points
        .iter()
        .map(|(_, lon)| format!("{lon:.4}"))
        .collect::<Vec<_>>()
        .join(",");
    let params = [
        ("latitude", lats),
        ("longitude", lons),
        ("hourly", hourly.join(",")),
        ("forecast_hours", "48".to_string()),
        ("past_hours", "0".to_string()),
        ("models", meta.query.to_string()),
        ("timezone", "UTC".to_string()),
    ];
    format!("{FORECAST_ORIGIN}?{}", form_query(&params))
}

fn hourly_variables(meta: &ModelMeta) -> String {
    let mut surface = vec![
        "surface_pressure".to_string(),
        "cloud_cover".to_string(),
        "cloud_cover_low".to_string(),
        "cloud_cover_mid".to_string(),
        "cloud_cover_high".to_string(),
        "temperature_2m".to_string(),
        "dew_point_2m".to_string(),
        "relative_humidity_2m".to_string(),
        "pressure_msl".to_string(),
        "wind_speed_10m".to_string(),
        "wind_direction_10m".to_string(),
        "wind_gusts_10m".to_string(),
        "visibility".to_string(),
        "precipitation".to_string(),
        "rain".to_string(),
        "showers".to_string(),
        "snowfall".to_string(),
        "weather_code".to_string(),
    ];
    if meta.id == "icon_seamless" {
        surface.push("convective_cloud_base".to_string());
        surface.push("cape".to_string());
    }
    let mut level = Vec::new();
    for hpa in POINT_LEVELS {
        level.push(format!("cloud_cover_{hpa}hPa"));
        level.push(format!("geopotential_height_{hpa}hPa"));
        level.push(format!("relative_humidity_{hpa}hPa"));
        level.push(format!("temperature_{hpa}hPa"));
        level.push(format!("wind_speed_{hpa}hPa"));
        level.push(format!("wind_direction_{hpa}hPa"));
    }
    surface.extend(level);
    surface.join(",")
}

fn js_number(value: f64) -> String {
    crate::js_json::format_js_number(value)
}

fn form_query(params: &[(&str, String)]) -> String {
    params
        .iter()
        .map(|(key, value)| format!("{}={}", form_encode(key), form_encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn form_encode(value: &str) -> String {
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

pub fn cache_ttl_ms(model: &str) -> i64 {
    match model {
        "gfs_seamless" | "icon_seamless" => 3 * 60 * 60 * 1000,
        "ecmwf_ifs025" | "gem_seamless" => 6 * 60 * 60 * 1000,
        "elevation" => 30 * 24 * 60 * 60 * 1000,
        _ => 15 * 60 * 1000,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ecmwf_point_url_matches_urlsearchparams() {
        let url = open_meteo_forecast_url(-33.456, -70.546, "ecmwf_ifs025", 48, 0);
        assert!(url.starts_with(
            "https://api.open-meteo.com/v1/forecast?latitude=-33.456&longitude=-70.546&hourly=surface_pressure%2Ccloud_cover%2Ccloud_cover_low%2C"
        ));
        assert!(url.ends_with("&forecast_hours=48&past_hours=0&models=ecmwf_ifs025&timezone=UTC"));
        assert!(!url.contains("apikey"));
        assert!(url.contains("wind_direction_500hPa"));
        assert!(!url.contains("convective_cloud_base"));
    }

    #[test]
    fn icon_point_url_appends_cape_and_the_convective_base() {
        let url = open_meteo_forecast_url(-33.456, -70.546, "icon_seamless", 48, 24);
        assert!(url.contains("weather_code%2Cconvective_cloud_base%2Ccape%2Ccloud_cover_1000hPa"));
        assert!(url.ends_with("&forecast_hours=48&past_hours=24&models=icon_seamless&timezone=UTC"));
    }
}
