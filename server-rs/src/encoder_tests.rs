//! Ports of the METAR/TAF vitest cases, including the three from PR #9.
//!
//! Comparisons are exact. The TypeScript `toBeCloseTo` checks are the same
//! feet expression on both sides, so this file asserts equality.

use crate::annex3::kmh_to_kt;
use crate::ceiling::{ceiling_from_hourly, flight_category_from_wx, M_TO_FT};
use crate::metar::{format_model_wind, generate_model_metar, metar_ddhhmmz, STAMP};
use crate::metar_wx::{
    annex3_nsc_eligible, cloud_height_hundreds_ft, derive_metar_wx_and_cloud,
    has_significant_cloud_below_nsc_ceiling,
};
use crate::msa::{airfield_msa, annex3_nsc_ceiling_ft_agl, ANNEX3_NSC_MIN_FT};
use crate::rmk::assert_est_only_in_trailing_rmk;
use crate::series::Series;
use crate::taf::{generate_model_taf, taf_ddhh, taf_validity_end};
use crate::taf_format::assert_model_taf_format;
use crate::utc::{parse_utc_iso, UtcStamp};
use crate::vis_wx::vis_obscuration_wx;
use crate::visibility::{estimate_visibility_meters, resolve_visibility_meters};
use serde_json::{json, Value};
use std::path::PathBuf;

fn series(value: Value) -> Series {
    Series::from_json(&value)
}

#[allow(clippy::too_many_arguments)]
fn derive(
    hourly: &Value,
    index: usize,
    elev: f64,
    icao: &str,
    vis: Option<f64>,
    for_taf: bool,
    estimated: bool,
    model: Option<&str>,
) -> crate::metar_wx::MetarWx {
    let series = series(hourly.clone());
    let ceil = ceiling_from_hourly(&series.hourly, index, elev);
    derive_metar_wx_and_cloud(
        &series, index, elev, icao, &ceil, vis, for_taf, estimated, model,
    )
}

fn ceil_of(hourly: &Value, index: usize, elev: f64) -> crate::ceiling::CeilingSample {
    ceiling_from_hourly(&series(hourly.clone()).hourly, index, elev)
}

fn metar(
    icao: &str,
    elev: f64,
    model: &str,
    run: &str,
    valid: &str,
    hourly: &Value,
    index: usize,
) -> crate::metar::ModelProduct {
    generate_model_metar(
        icao,
        elev,
        model,
        run,
        valid,
        &series(hourly.clone()),
        index,
    )
    .expect("metar")
}

fn taf(
    icao: &str,
    elev: f64,
    model: &str,
    run: &str,
    hourly: &Value,
) -> crate::metar::ModelProduct {
    generate_model_taf(icao, elev, model, run, &series(hourly.clone())).expect("taf")
}

fn times_from(start: &str, count: usize) -> Vec<String> {
    let start = parse_utc_iso(start).unwrap();
    (0..count)
        .map(|offset| {
            let parts = start.plus_hours(offset as i32).parts();
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}",
                parts.year,
                parts.month0 + 1,
                parts.day,
                parts.hour,
                parts.minute
            )
        })
        .collect()
}

fn pad_hours(start_hour: u32, count: usize) -> Vec<String> {
    (0..count)
        .map(|offset| format!("2026-11-17T{:02}:00", start_hour + offset as u32))
        .collect()
}

fn hundreds(feet: f64) -> String {
    format!("{:03}", cloud_height_hundreds_ft(feet))
}

fn has_plain_ra_or_dz(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let boundary = index == 0 || bytes[index - 1].is_ascii_whitespace();
        if boundary {
            let mut rest = index;
            if bytes
                .get(rest)
                .is_some_and(|byte| *byte == b'+' || *byte == b'-')
            {
                rest += 1;
            }
            for token in [b"RA".as_slice(), b"DZ".as_slice()] {
                if bytes[rest..].starts_with(token) {
                    let end = rest + token.len();
                    let end_ok = end == bytes.len() || bytes[end].is_ascii_whitespace();
                    if end_ok {
                        return true;
                    }
                }
            }
        }
        index += 1;
    }
    false
}

fn expect_no_ra_dz_with_clear_sky(raw: &str) {
    let body = raw.split(" RMK ").next().unwrap_or(raw);
    for part in split_change_groups(body) {
        if has_plain_ra_or_dz(part)
            && !part
                .split_whitespace()
                .any(|token| token == "SHRA" || token.ends_with("SHRA"))
        {
            assert!(!part.contains("NSC") && !part.contains("NCD"), "{part}");
        }
        if part.contains("NSC") || part.contains("NCD") {
            assert!(!has_plain_ra_or_dz(part), "{part}");
        }
    }
}

fn expect_no_shower_with_clear_sky(raw: &str) {
    let body = raw.split(" RMK ").next().unwrap_or(raw);
    for part in split_change_groups(body) {
        if shower_token(part) {
            assert!(!part.contains("NSC") && !part.contains("NCD"), "{part}");
            assert!(
                part.split_whitespace().any(|token| {
                    let rest = token
                        .strip_prefix("FEW")
                        .or_else(|| token.strip_prefix("SCT"))
                        .or_else(|| token.strip_prefix("BKN"))
                        .or_else(|| token.strip_prefix("OVC"));
                    matches!(rest, Some(rest) if rest == "///" || (rest.len() == 3 && rest.bytes().all(|b| b.is_ascii_digit())))
                }),
                "{part}"
            );
        }
    }
}

fn shower_token(text: &str) -> bool {
    text.split_whitespace().any(|token| {
        let token = token.strip_prefix(['+', '-']).unwrap_or(token);
        token.starts_with("SH") && token.chars().all(|ch| ch.is_ascii_uppercase())
    })
}

fn split_change_groups(body: &str) -> Vec<&str> {
    let mut parts = vec![0];
    let tags = ["BECMG", "TEMPO", "FM", "PROB30", "PROB40"];
    let bytes = body.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !body.is_char_boundary(index) {
            index += 1;
            continue;
        }
        let boundary = index == 0 || !bytes[index - 1].is_ascii_alphanumeric();
        if boundary {
            for tag in tags {
                let after = index + tag.len();
                if body[index..].starts_with(tag)
                    && (after == bytes.len() || !bytes[after].is_ascii_alphanumeric())
                {
                    parts.push(index);
                    break;
                }
            }
        }
        index += 1;
    }
    parts.push(body.len());
    parts
        .windows(2)
        .map(|window| &body[window[0]..window[1]])
        .collect()
}

fn ddhh_span_hours(from: &str, to: &str) -> i32 {
    let f_day: i32 = from[..2].parse().unwrap();
    let t_day: i32 = to[..2].parse().unwrap();
    let f_hour: i32 = from[2..4].parse().unwrap();
    let t_hour: i32 = to[2..4].parse().unwrap();
    let mut days = t_day - f_day;
    if days < 0 {
        days += 31;
    }
    days * 24 + (t_hour - f_hour)
}

fn becmg_windows(raw: &str) -> Vec<(String, String)> {
    let bytes = raw.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index + 4 < bytes.len() {
        if raw.is_char_boundary(index) && raw[index..].starts_with("BECMG ") {
            let rest = &raw[index + 6..];
            if rest.len() >= 9 && rest.as_bytes()[4] == b'/' {
                let from = &rest[..4];
                let to = &rest[5..9];
                if from.bytes().all(|b| b.is_ascii_digit())
                    && to.bytes().all(|b| b.is_ascii_digit())
                {
                    out.push((from.to_string(), to.to_string()));
                }
            }
        }
        index += 1;
    }
    out
}

fn fixture_hourly() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/taf-hourly.json");
    let raw = std::fs::read(path).unwrap();
    let value: Value = serde_json::from_slice(&raw).unwrap();
    value["hourly"].clone()
}

const UNRESOLVED_LOW_BKN: &str = r#"{
  "cloud_cover_low": [90],
  "surface_pressure": [980],
  "cloud_cover_925hPa": [10],
  "geopotential_height_925hPa": [800],
  "cloud_cover_850hPa": [20],
  "geopotential_height_850hPa": [1600]
}"#;

fn unresolved() -> Value {
    serde_json::from_str(UNRESOLVED_LOW_BKN).unwrap()
}

fn merge(mut base: Value, extra: Value) -> Value {
    let dst = base.as_object_mut().unwrap();
    for (key, value) in extra.as_object().unwrap() {
        dst.insert(key.clone(), value.clone());
    }
    base
}

#[test]
fn metar_stamp_time_qnh_and_gust_order() {
    let mut hourly = fixture_hourly();
    hourly["dew_point_2m"] = json!([8]);
    hourly["pressure_msl"] = json!([1013.2]);
    hourly["visibility"] = json!([8000]);
    let raw = metar(
        "SCEL",
        474.0,
        "gfs_seamless",
        "2026-11-17T12:00:00Z",
        "2026-11-17T18:30:00Z",
        &hourly,
        0,
    );
    assert!(raw.raw.starts_with(STAMP));
    assert_eq!(metar_ddhhmmz("2026-11-17T18:30:00Z").unwrap(), "171830Z");
    assert!(raw.raw.contains("171830Z"));
    assert!(!raw.raw.contains("AUTO"));
    assert!(raw.raw.contains("Q1013"));
    assert!(raw.raw.split_whitespace().any(|token| token.contains('/')));

    assert_eq!(
        format_model_wind(Some(352.0), Some(30.0), Some(60.0)),
        "35016G32KT"
    );
    let gusty = json!({
        "time": ["2026-11-10T06:00"],
        "temperature_2m": [-2.4],
        "dew_point_2m": [-3.6],
        "pressure_msl": [1021.7],
        "wind_direction_10m": [352],
        "wind_speed_10m": [30],
        "wind_gusts_10m": [60],
        "visibility": [2400],
        "weather_code": [63],
        "surface_pressure": [980]
    });
    let line = metar(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-10T06:00:00Z",
        "2026-11-10T06:00:00Z",
        &gusty,
        0,
    )
    .raw
    .split('\n')
    .nth(1)
    .unwrap()
    .to_string();
    let vis_idx = line.find("2400").unwrap();
    let wind_idx = line.find("35016G32KT").unwrap();
    assert!(vis_idx > wind_idx);
}

#[test]
fn negative_half_temperature_group_rounds_toward_the_warmer_degree() {
    let hourly = json!({
        "time": ["2026-11-17T06:00"],
        "temperature_2m": [-1.5],
        "dew_point_2m": [-0.5],
        "pressure_msl": [1013.0],
        "relative_humidity_2m": [90],
        "visibility": [9999],
        "wind_speed_10m": [10],
        "wind_direction_10m": [180],
        "surface_pressure": [940]
    });
    let raw = metar(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T06:00:00Z",
        "2026-11-17T06:00:00Z",
        &hourly,
        0,
    );
    assert!(raw.raw.contains("M01/M00"), "{}", raw.raw);
    let m00 = json!({
        "time": ["2026-11-17T06:00"],
        "temperature_2m": [-0.4],
        "dew_point_2m": [-0.1],
        "pressure_msl": [1013.0],
        "relative_humidity_2m": [95],
        "visibility": [9999],
        "wind_speed_10m": [10],
        "wind_direction_10m": [180],
        "surface_pressure": [940]
    });
    let raw = metar(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T06:00:00Z",
        "2026-11-17T06:00:00Z",
        &m00,
        0,
    );
    assert!(raw.raw.contains("M00/M00"), "{}", raw.raw);
    assert_eq!(kmh_to_kt(Some(-1.5 * 1.852)), Some(-1.0));
}

#[test]
fn derive_weather_cloud_and_ecmwf_rules() {
    let hourly = merge(
        json!({
            "time": ["t"],
            "temperature_2m": [21],
            "dew_point_2m": [9],
            "relative_humidity_2m": [46],
            "precipitation": [0.2],
            "showers": [0.2],
            "rain": [0],
            "visibility": [9999]
        }),
        unresolved(),
    );
    let dry_spread = derive(&hourly, 0, 649.0, "SCTB", Some(9999.0), false, false, None);
    assert!(!dry_spread.weather.contains("DZ"));
    assert!(dry_spread.weather.contains("-SHRA"));
    assert!(cloud_code(&dry_spread.clouds, "BKN"));

    let ordered = json!({
        "time": ["a", "b", "c"],
        "temperature_2m": [11, 11, 11],
        "dew_point_2m": [9, 9, 9],
        "relative_humidity_2m": [85, 85, 85],
        "precipitation": [0.2, 0.2, 0.2],
        "rain": [0, 0, 0],
        "showers": [0, 0, 0],
        "cloud_cover_low": [80, 80, 80],
        "surface_pressure": [980, 980, 980],
        "cloud_cover_925hPa": [80, 80, 80],
        "geopotential_height_925hPa": [900, 900, 900]
    });
    assert_eq!(
        derive(&ordered, 1, 649.0, "SCTB", Some(3000.0), false, false, None).weather,
        "-DZ BR"
    );

    let lcl = merge(
        json!({
            "time": ["t"],
            "temperature_2m": [20],
            "dew_point_2m": [9],
            "relative_humidity_2m": [50]
        }),
        unresolved(),
    );
    let lcl_ft = 125.0 * (20.0 - 9.0) * M_TO_FT;
    assert_eq!(cloud_height_hundreds_ft(lcl_ft), 45);
    let estimated = derive(&lcl, 0, 649.0, "SCTB", Some(9999.0), false, false, None);
    assert_eq!(estimated.clouds, "BKN045");
    assert!(estimated.rmk_extra.iter().any(|item| item == "CLD EST"));
    assert!(estimated.cld_estimated);

    let hot = merge(
        json!({
            "time": ["2026-08-18T12:00", "2026-08-18T13:00", "2026-08-18T14:00", "2026-08-18T15:00"],
            "temperature_2m": [26, 26, 26, 26],
            "dew_point_2m": [9, 9, 9, 9],
            "relative_humidity_2m": [40, 40, 40, 40],
            "pressure_msl": [1010, 1010, 1010, 1010],
            "wind_speed_10m": [10, 10, 10, 10],
            "wind_direction_10m": [230, 230, 230, 230],
            "wind_gusts_10m": [20, 20, 20, 20],
            "visibility": [9999, 9999, 9999, 9999],
            "precipitation": [0, 0, 0, 0],
            "rain": [0, 0, 0, 0],
            "showers": [0, 0, 0, 0]
        }),
        unresolved(),
    );
    assert_eq!(
        derive(&hot, 0, 649.0, "SCTB", Some(9999.0), false, false, None).clouds,
        "BKN///"
    );
    let taf_hot = derive(&hot, 0, 649.0, "SCTB", Some(9999.0), true, false, None);
    assert_eq!(taf_hot.clouds, "BKN050");
    assert!(taf_hot.rmk_extra.iter().any(|item| item == "CLD EST"));
    let hot_metar = metar(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-08-18T12:00:00Z",
        "2026-08-18T12:00:00Z",
        &hot,
        0,
    );
    assert!(hot_metar.raw.contains("BKN///"));
    assert!(hot_metar.raw.contains("CLD BASE UNK"));
    assert_eq!(hot_metar.raw.matches("RMK").count(), 1);
    let hot_taf = taf("SCTB", 649.0, "gfs_seamless", "2026-08-18T12:00:00Z", &hot);
    assert!(hot_taf.raw.contains("BKN050"));
    assert!(hot_taf.raw.contains("CLD EST"));

    let nsc = json!({
        "time": ["t"],
        "temperature_2m": [20],
        "dew_point_2m": [8],
        "relative_humidity_2m": [50],
        "cloud_cover_low": [25],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [10],
        "geopotential_height_925hPa": [800]
    });
    assert!(annex3_nsc_eligible(&series(nsc.clone()), 0, 649.0, "SCTB"));
    assert_eq!(
        derive(&nsc, 0, 649.0, "SCTB", Some(9999.0), false, false, None).clouds,
        "NSC"
    );

    let resolved = json!({
        "time": ["t"],
        "temperature_2m": [14],
        "dew_point_2m": [13],
        "relative_humidity_2m": [95],
        "cloud_cover_low": [90],
        "precipitation": [0],
        "visibility": [8000],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [80],
        "geopotential_height_925hPa": [800]
    });
    let resolved_wx = derive(
        &resolved,
        0,
        649.0,
        "SCTB",
        Some(8000.0),
        false,
        false,
        None,
    );
    assert!(cloud_code(&resolved_wx.clouds, "BKN") || cloud_code(&resolved_wx.clouds, "OVC"));
    assert!(!resolved_wx.cld_estimated);

    let cape = json!({
        "time": ["t"],
        "temperature_2m": [22],
        "dew_point_2m": [8],
        "relative_humidity_2m": [40],
        "surface_pressure": [955],
        "convective_cloud_base": [2000],
        "cape": [250],
        "showers": [0],
        "rain": [0],
        "precipitation": [0],
        "cloud_cover_low": [8],
        "cloud_cover_850hPa": [5],
        "geopotential_height_850hPa": [2200]
    });
    let cape_wx = derive(&cape, 0, 649.0, "SCTB", Some(9999.0), false, false, None);
    assert!(cloud_code(&cape_wx.clouds, "FEW"));
    assert_eq!(cape_wx.effective_ceil_ft, None);
}

fn cloud_code(group: &str, prefix: &str) -> bool {
    group.starts_with(prefix)
        && group.len() == prefix.len() + 3
        && group[prefix.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_digit())
}

#[test]
fn showers_and_rain_need_a_cloud_layer() {
    let dry = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [28],
        "dew_point_2m": [6],
        "relative_humidity_2m": [30],
        "precipitation": [0.4],
        "showers": [0.4],
        "rain": [0],
        "visibility": [8000],
        "cloud_cover_low": [5],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [5],
        "geopotential_height_925hPa": [2200],
        "pressure_msl": [1013],
        "wind_speed_10m": [12],
        "wind_direction_10m": [230],
        "wind_gusts_10m": [16]
    });
    let dropped = derive(&dry, 0, 649.0, "SCTB", Some(8000.0), false, false, None);
    assert_eq!(dropped.clouds, "NSC");
    assert!(!dropped.weather.contains("SH"));
    let dry_metar = metar(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T18:00:00Z",
        "2026-11-17T18:00:00Z",
        &dry,
        0,
    );
    expect_no_shower_with_clear_sky(&dry_metar.raw);
    assert!(!dry_metar.raw.contains("SHRA"));
    let n = 6;
    let taf_hourly = json!({
        "time": pad_hours(16, n),
        "temperature_2m": vec![28.0; n],
        "dew_point_2m": vec![6.0; n],
        "relative_humidity_2m": vec![30.0; n],
        "precipitation": [0, 0, 0.4, 0.4, 0, 0],
        "showers": [0, 0, 0.4, 0.4, 0, 0],
        "rain": vec![0.0; n],
        "visibility": vec![8000.0; n],
        "cloud_cover_low": vec![5.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_925hPa": vec![5.0; n],
        "geopotential_height_925hPa": vec![2200.0; n],
        "pressure_msl": vec![1013.0; n],
        "wind_speed_10m": vec![12.0; n],
        "wind_direction_10m": vec![230.0; n],
        "wind_gusts_10m": vec![16.0; n]
    });
    let dry_taf = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T16:00:00Z",
        &taf_hourly,
    );
    expect_no_shower_with_clear_sky(&dry_taf.raw);
    assert!(!dry_taf.raw.contains("SHRA"));

    let mut showers = vec![0.0; n];
    showers[3] = 0.4;
    let convective = json!({
        "time": pad_hours(16, n),
        "temperature_2m": vec![18.0; n],
        "dew_point_2m": vec![10.0; n],
        "relative_humidity_2m": vec![60.0; n],
        "precipitation": showers.clone(),
        "showers": showers,
        "rain": vec![0.0; n],
        "visibility": vec![9000.0; n],
        "cloud_cover_low": vec![5.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_925hPa": vec![5.0; n],
        "geopotential_height_925hPa": vec![2200.0; n],
        "pressure_msl": vec![1013.0; n],
        "wind_speed_10m": vec![16.0; n],
        "wind_direction_10m": vec![180.0; n],
        "wind_gusts_10m": vec![18.0; n]
    });
    let layer = derive(
        &convective,
        3,
        649.0,
        "SCTB",
        Some(9000.0),
        false,
        false,
        None,
    );
    assert!(layer.weather.contains("-SHRA"));
    assert!(
        cloud_code(&layer.clouds, "FEW")
            || cloud_code(&layer.clouds, "SCT")
            || cloud_code(&layer.clouds, "BKN")
    );
    assert!(layer.rmk_extra.iter().any(|item| item == "CLD EST"));
    let layer_metar = metar(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T19:00:00Z",
        "2026-11-17T19:00:00Z",
        &convective,
        3,
    );
    expect_no_shower_with_clear_sky(&layer_metar.raw);
    assert!(layer_metar.raw.contains("SHRA"));
    assert!(layer_metar.raw.contains("CLD EST"));
    let layer_taf = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T16:00:00Z",
        &convective,
    );
    expect_no_shower_with_clear_sky(&layer_taf.raw);
    assert!(layer_taf.raw.contains("TEMPO"));
    assert!(layer_taf.raw.contains("-SHRA"));

    let bare = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [12],
        "dew_point_2m": [10],
        "relative_humidity_2m": [85],
        "precipitation": [0.4],
        "rain": [0.4],
        "showers": [0],
        "visibility": [8000],
        "pressure_msl": [1013],
        "wind_speed_10m": [12],
        "wind_direction_10m": [200],
        "wind_gusts_10m": [14],
        "cloud_cover_low": [5],
        "cloud_cover_mid": [10],
        "cloud_cover": [20],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [5],
        "geopotential_height_925hPa": [2200],
        "cloud_cover_850hPa": [5],
        "geopotential_height_850hPa": [1600]
    });
    let no_layer = derive(&bare, 0, 649.0, "SCTB", Some(8000.0), false, false, None);
    assert_eq!(no_layer.clouds, "NSC");
    assert!(!has_plain_ra_or_dz(&no_layer.weather));
    expect_no_ra_dz_with_clear_sky(
        &metar(
            "SCTB",
            649.0,
            "gfs_seamless",
            "2026-11-17T18:00:00Z",
            "2026-11-17T18:00:00Z",
            &bare,
            0,
        )
        .raw,
    );
    let rain_taf_hourly = json!({
        "time": pad_hours(16, n),
        "temperature_2m": vec![12.0; n],
        "dew_point_2m": vec![10.0; n],
        "relative_humidity_2m": vec![85.0; n],
        "precipitation": [0, 0, 0.4, 0.4, 0, 0],
        "rain": [0, 0, 0.4, 0.4, 0, 0],
        "showers": vec![0.0; n],
        "visibility": vec![8000.0; n],
        "pressure_msl": vec![1013.0; n],
        "wind_speed_10m": vec![12.0; n],
        "wind_direction_10m": vec![200.0; n],
        "wind_gusts_10m": vec![14.0; n],
        "cloud_cover_low": vec![5.0; n],
        "cloud_cover_mid": vec![10.0; n],
        "cloud_cover": vec![20.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_925hPa": vec![5.0; n],
        "geopotential_height_925hPa": vec![2200.0; n]
    });
    let rain_taf = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T16:00:00Z",
        &rain_taf_hourly,
    );
    expect_no_ra_dz_with_clear_sky(&rain_taf.raw);
    assert!(!has_plain_ra_or_dz(&rain_taf.raw));
}

#[test]
fn ecmwf_layer_trace_mid_deck_lcl_and_missing_fields() {
    let gh = 3100.0;
    let elev = 649.0;
    let agl = (gh - elev) * M_TO_FT;
    let backed = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [12],
        "dew_point_2m": [10],
        "relative_humidity_2m": [85],
        "precipitation": [0.4],
        "rain": [0.4],
        "showers": [0],
        "visibility": [9000],
        "cloud_cover_low": [10],
        "cloud_cover_mid": [60],
        "cloud_cover": [40],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [10],
        "geopotential_height_925hPa": [2200],
        "geopotential_height_700hPa": [gh],
        "pressure_msl": [1013],
        "wind_speed_10m": [12],
        "wind_direction_10m": [200]
    });
    let backed_wx = derive(&backed, 0, elev, "SCTB", Some(9000.0), false, false, None);
    assert!(backed_wx.weather.contains("-RA"));
    assert_eq!(backed_wx.clouds, format!("BKN{}", hundreds(agl)));
    assert_eq!(backed_wx.effective_ceil_ft, Some(agl));
    assert!(backed_wx.rmk_extra.iter().any(|item| item == "CLD EST"));

    let low_lcl = json!({
        "time": ["2026-11-17T06:00"],
        "temperature_2m": [9],
        "dew_point_2m": [8.6],
        "relative_humidity_2m": [96],
        "precipitation": [0.3],
        "rain": [0.3],
        "showers": [0],
        "visibility": [8000],
        "cloud_cover_low": [2],
        "cloud_cover_mid": [8],
        "cloud_cover": [12],
        "surface_pressure": [980],
        "geopotential_height_700hPa": [gh],
        "pressure_msl": [1014],
        "wind_speed_10m": [4],
        "wind_direction_10m": [160]
    });
    let lcl_ft = 125.0 * (9.0 - 8.6) * M_TO_FT;
    assert!(lcl_ft < 1500.0);
    let few = derive(
        &low_lcl,
        0,
        elev,
        "SCTB",
        Some(8000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert_eq!(few.clouds, format!("FEW{}", hundreds(agl)));
    let group_hundreds: i64 = few.clouds[3..].parse().unwrap();
    assert!(group_hundreds * 100 >= 1500);
    assert!(few.weather.contains("SHRA"));
    assert!(!few.weather.split_whitespace().any(|token| token == "HZ"));

    let mid = json!({
        "time": ["2026-11-17T06:00"],
        "temperature_2m": [9],
        "dew_point_2m": [8.6],
        "relative_humidity_2m": [96],
        "precipitation": [0.3],
        "rain": [0.3],
        "showers": [0],
        "visibility": [9000],
        "cloud_cover_low": [2],
        "cloud_cover_mid": [55],
        "cloud_cover": [20],
        "surface_pressure": [980],
        "geopotential_height_700hPa": [gh]
    });
    let mid_wx = derive(
        &mid,
        0,
        elev,
        "SCTB",
        Some(9000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert_eq!(mid_wx.clouds, format!("BKN{}", hundreds(agl)));
    assert_eq!(mid_wx.effective_ceil_ft, Some(agl));
    assert!(mid_wx.weather.contains("-RA"));
    assert!(!mid_wx.weather.contains("SHRA"));

    let cirrus = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [16],
        "dew_point_2m": [8],
        "relative_humidity_2m": [55],
        "precipitation": [0.4],
        "rain": [0.4],
        "showers": [0],
        "visibility": [9000],
        "cloud_cover_low": [4],
        "cloud_cover_mid": [6],
        "cloud_cover": [90],
        "surface_pressure": [980],
        "geopotential_height_700hPa": [gh],
        "cape": [0]
    });
    let cirrus_wx = derive(
        &cirrus,
        0,
        elev,
        "SCTB",
        Some(9000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert_eq!(cirrus_wx.clouds, format!("FEW{}", hundreds(agl)));
    assert!(!cirrus_wx.clouds.starts_with("BKN"));
    assert!(cirrus_wx.weather.contains("SHRA"));

    let trace = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [16],
        "dew_point_2m": [8],
        "relative_humidity_2m": [55],
        "precipitation": [0.15],
        "rain": [0.15],
        "showers": [0],
        "visibility": [9000],
        "cloud_cover_low": [4],
        "cloud_cover_mid": [6],
        "cloud_cover": [12],
        "surface_pressure": [980],
        "geopotential_height_700hPa": [3100],
        "cape": [0]
    });
    let trace_wx = derive(
        &trace,
        0,
        649.0,
        "SCTB",
        Some(9000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert!(!trace_wx.weather.contains("SHRA") && !has_plain_ra_or_dz(&trace_wx.weather));
    assert!(
        !trace_wx.clouds.starts_with("FEW")
            && !trace_wx.clouds.starts_with("SCT")
            && !trace_wx.clouds.starts_with("BKN")
            && !trace_wx.clouds.starts_with("OVC")
    );
    assert!(!trace_wx.cld_estimated);

    let deck = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [12],
        "dew_point_2m": [8],
        "relative_humidity_2m": [70],
        "precipitation": [0.4],
        "rain": [0.4],
        "showers": [0],
        "visibility": [9000],
        "cloud_cover_low": [8],
        "cloud_cover_mid": [60],
        "cloud_cover": [40],
        "surface_pressure": [980],
        "geopotential_height_700hPa": [gh],
        "cape": [0]
    });
    let rain = derive(
        &deck,
        0,
        elev,
        "SCTB",
        Some(9000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert_eq!(rain.clouds, format!("BKN{}", hundreds(agl)));
    assert!(rain.weather.contains("-RA"));
    assert!(!rain.weather.contains("SHRA"));
    let mut convective_deck = deck.clone();
    convective_deck["cape"] = json!([250]);
    let convective = derive(
        &convective_deck,
        0,
        elev,
        "SCTB",
        Some(9000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert!(convective.weather.contains("SHRA"));
    assert!(!has_plain_ra_or_dz(&convective.weather));
    let mut low = deck.clone();
    low["cloud_cover_low"] = json!([80]);
    low["cloud_cover_925hPa"] = json!([80]);
    low["geopotential_height_925hPa"] = json!([900]);
    low["cape"] = json!([0]);
    let showers = derive(
        &low,
        0,
        elev,
        "SCTB",
        Some(9000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert!(showers.weather.contains("SHRA"));
    assert!(!has_plain_ra_or_dz(&showers.weather));

    let gh600 = 4200.0;
    let agl600 = (gh600 - elev) * M_TO_FT;
    let light600 = json!({
        "time": ["2026-11-17T06:00"],
        "temperature_2m": [9],
        "dew_point_2m": [8.6],
        "relative_humidity_2m": [96],
        "precipitation": [0.3],
        "rain": [0.3],
        "showers": [0],
        "visibility": [8000],
        "cloud_cover_low": [2],
        "cloud_cover_mid": [8],
        "cloud_cover": [12],
        "surface_pressure": [980],
        "geopotential_height_600hPa": [gh600]
    });
    let few600 = derive(
        &light600,
        0,
        elev,
        "SCTB",
        Some(8000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert_eq!(few600.clouds, format!("FEW{}", hundreds(agl600)));
    assert!(few600.weather.contains("SHRA"));
    let deck600 = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [12],
        "dew_point_2m": [8],
        "relative_humidity_2m": [70],
        "precipitation": [0.4],
        "rain": [0.4],
        "showers": [0],
        "visibility": [9000],
        "cloud_cover_low": [8],
        "cloud_cover_mid": [60],
        "cloud_cover": [40],
        "surface_pressure": [980],
        "geopotential_height_700hPa": [null],
        "geopotential_height_600hPa": [gh600],
        "cape": [0]
    });
    let rain600 = derive(
        &deck600,
        0,
        elev,
        "SCTB",
        Some(9000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert_eq!(rain600.clouds, format!("BKN{}", hundreds(agl600)));
    assert_eq!(rain600.effective_ceil_ft, Some(agl600));
    assert!(rain600.rmk_extra.iter().any(|item| item == "CLD EST"));
    assert!(rain600
        .weather
        .split_whitespace()
        .any(|token| token == "-RA"));
    assert!(!rain600.weather.contains("SHRA"));

    let shared = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [16],
        "dew_point_2m": [8],
        "relative_humidity_2m": [55],
        "precipitation": [0.4],
        "rain": [0.4],
        "showers": [0],
        "visibility": [9000],
        "cloud_cover_low": [8],
        "cloud_cover": [40],
        "surface_pressure": [980],
        "geopotential_height_700hPa": [gh],
        "cape": [0]
    });
    let few_group = format!("FEW{}", hundreds(agl));
    for hourly in [
        shared.clone(),
        merge(shared.clone(), json!({"cloud_cover_mid": [null]})),
    ] {
        let encoded = derive(
            &hourly,
            0,
            elev,
            "SCTB",
            Some(9000.0),
            false,
            false,
            Some("ecmwf_ifs025"),
        );
        assert_eq!(encoded.clouds, few_group);
        assert!(encoded.weather.contains("SHRA"));
        assert!(!has_plain_ra_or_dz(&encoded.weather));
    }
    let with_mid = derive(
        &merge(shared, json!({"cloud_cover_mid": [60]})),
        0,
        elev,
        "SCTB",
        Some(9000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert!(with_mid.clouds.starts_with("BKN"));
    assert!(with_mid
        .weather
        .split_whitespace()
        .any(|token| token == "-RA"));
    assert!(!with_mid.weather.contains("SHRA"));
}

#[test]
fn haze_drop_obscuration_vv_and_category() {
    let layer = json!({
        "cloud_cover_low": [70],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [70],
        "geopotential_height_925hPa": [1140]
    });
    let hazy = merge(
        json!({
            "time": ["t"],
            "temperature_2m": [16],
            "dew_point_2m": [8],
            "relative_humidity_2m": [55],
            "precipitation": [0.4],
            "showers": [0.4],
            "rain": [0],
            "visibility": [5000]
        }),
        layer,
    );
    let dry_haze = derive(&hazy, 0, 649.0, "SCTB", Some(5000.0), false, false, None);
    assert!(dry_haze.weather.contains("SHRA"));
    assert!(!dry_haze
        .weather
        .split_whitespace()
        .any(|token| token == "HZ"));
    assert!(cloud_code(&dry_haze.clouds, "BKN"));
    let mut moist = hazy.clone();
    moist["relative_humidity_2m"] = json!([85]);
    moist["dew_point_2m"] = json!([14]);
    let with_br = derive(&moist, 0, 649.0, "SCTB", Some(5000.0), false, false, None);
    assert!(with_br.weather.contains("SHRA BR"));

    let ecmwf_rain = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [14],
        "dew_point_2m": [12],
        "relative_humidity_2m": [80],
        "precipitation": [0.8],
        "rain": [0.8],
        "showers": [0],
        "visibility": [9000],
        "cloud_cover_low": [80],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [80],
        "geopotential_height_925hPa": [900]
    });
    let showers = derive(
        &ecmwf_rain,
        0,
        649.0,
        "SCTB",
        Some(9000.0),
        false,
        false,
        Some("ecmwf_ifs025"),
    );
    assert!(showers.weather.contains("SHRA"));
    assert!(!has_plain_ra_or_dz(&showers.weather));

    let threshold = annex3_nsc_ceiling_ft_agl("SCTB", 649.0);
    let agl600 = (4200.0 - 649.0) * M_TO_FT;
    assert!(agl600 > 5000.0 && agl600 < threshold);
    let low = json!({
        "time": ["t"],
        "surface_pressure": [900],
        "cloud_cover_600hPa": [80],
        "geopotential_height_600hPa": [4200]
    });
    assert!(has_significant_cloud_below_nsc_ceiling(
        &series(low.clone()),
        0,
        649.0,
        "SCTB"
    ));
    assert!(!annex3_nsc_eligible(&series(low.clone()), 0, 649.0, "SCTB"));
    let above = 649.0 + (threshold + 800.0) / M_TO_FT;
    let mut higher = low.clone();
    higher["geopotential_height_600hPa"] = json!([above]);
    assert!(!has_significant_cloud_below_nsc_ceiling(
        &series(higher),
        0,
        649.0,
        "SCTB"
    ));
    let at500 = json!({
        "time": ["t"],
        "surface_pressure": [900],
        "cloud_cover_500hPa": [70],
        "geopotential_height_500hPa": [5600]
    });
    assert!((5600.0 - 649.0) * M_TO_FT < threshold);
    assert!(has_significant_cloud_below_nsc_ceiling(
        &series(at500),
        0,
        649.0,
        "SCTB"
    ));

    let obscured = json!({
        "time": ["2026-11-17T12:00"],
        "temperature_2m": [8],
        "dew_point_2m": [7.6],
        "relative_humidity_2m": [97],
        "precipitation": [0.6],
        "rain": [0],
        "showers": [0],
        "visibility": [400],
        "cloud_cover_low": [90],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [40],
        "geopotential_height_925hPa": [900],
        "pressure_msl": [1014],
        "wind_speed_10m": [6],
        "wind_direction_10m": [180],
        "wind_gusts_10m": [8]
    });
    assert!(ceil_of(&obscured, 0, 649.0).obscured);
    let fog_rain = derive(
        &obscured,
        0,
        649.0,
        "SCTB",
        Some(400.0),
        false,
        false,
        Some("gfs_seamless"),
    );
    assert_eq!(fog_rain.clouds, "VV000");
    assert!(
        fog_rain
            .weather
            .split_whitespace()
            .any(|token| token == "-RA")
            || fog_rain
                .weather
                .split_whitespace()
                .any(|token| token == "-DZ")
    );
    assert!(
        !fog_rain
            .weather
            .split_whitespace()
            .any(|token| token == "FG"),
        "daytime obscured rain is not FG: {}",
        fog_rain.weather
    );
    let fog_metar = metar(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T12:00:00Z",
        "2026-11-17T12:00:00Z",
        &obscured,
        0,
    );
    assert!(fog_metar.raw.contains("VV000"), "{}", fog_metar.raw);
    assert!(
        !fog_metar.raw.split_whitespace().any(|token| token == "FG"),
        "12:00 UTC is day at SCTB: {}",
        fog_metar.raw
    );

    let agl_shower = 250.0 * M_TO_FT;
    let heavy = json!({
        "time": ["2026-11-17T18:00"],
        "temperature_2m": [14],
        "dew_point_2m": [12],
        "relative_humidity_2m": [80],
        "precipitation": [3],
        "showers": [3],
        "rain": [0],
        "visibility": [9999],
        "cloud_cover_low": [8],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [5],
        "geopotential_height_925hPa": [2200]
    });
    assert!(ceil_of(&heavy, 0, 649.0).ceiling_ft_agl.is_none());
    let heavy_wx = derive(&heavy, 0, 649.0, "SCTB", Some(9999.0), false, false, None);
    assert_eq!(heavy_wx.clouds, format!("BKN{}", hundreds(agl_shower)));
    assert_eq!(heavy_wx.effective_ceil_ft, Some(agl_shower));
    assert_eq!(
        heavy_wx.flight_category,
        flight_category_from_wx(Some(9999.0), Some(agl_shower))
    );
    assert_eq!(heavy_wx.flight_category, "IFR");

    let clear = json!({
        "time": ["t"],
        "visibility": [10000],
        "temperature_2m": [15],
        "dew_point_2m": [14]
    });
    assert!(
        !derive(&clear, 0, 100.0, "SCVM", Some(9999.0), false, false, None)
            .weather
            .contains("FG")
    );
}

#[test]
fn msa_citations_and_bkn_unknown() {
    let sctb = airfield_msa("SCTB").unwrap();
    assert_eq!(sctb.msa_ft_amsl, 20_000.0);
    assert!(!sctb.assumption);
    assert!(sctb.citation.contains("IAC 1") && sctb.citation.contains("AMDT 100"));
    let elev_ft = 649.0 * M_TO_FT;
    assert_eq!(
        annex3_nsc_ceiling_ft_agl("SCTB", 649.0),
        ANNEX3_NSC_MIN_FT.max(20_000.0 - elev_ft)
    );
    let ft = annex3_nsc_ceiling_ft_agl("SCTB", 649.0);
    assert!(ft > ANNEX3_NSC_MIN_FT);
    assert!(ft >= 9_000.0);
    let scvh = airfield_msa("SCVH").unwrap();
    assert!(scvh.assumption && scvh.msa_ft_amsl == 9_500.0);
    assert!(scvh.citation.contains("Chacabuco") && scvh.citation.contains("ASSUMPTION"));
    assert!(!scvh
        .citation
        .to_ascii_lowercase()
        .contains("coastal sector as scvm"));
    let scvh_ft = annex3_nsc_ceiling_ft_agl("SCVH", 652.0);
    assert!(scvh_ft > ANNEX3_NSC_MIN_FT);
    assert!(scvh_ft >= 7_000.0);
    assert_eq!(airfield_msa("SCEL").unwrap().msa_ft_amsl, 19_000.0);
    assert!(!airfield_msa("SCEL").unwrap().assumption);
    assert_eq!(airfield_msa("SCVM").unwrap().msa_ft_amsl, 9_500.0);
    assert!(airfield_msa("SCPD").unwrap().assumption);
    for icao in ["SCTB", "SCEL", "SCVM"] {
        let row = airfield_msa(icao).unwrap();
        assert!(
            row.citation.contains("AMDT")
                && row.citation.contains("MSA")
                && row.citation.contains("aipchile.dgac.gob.cl")
        );
    }
    let dry = json!({
        "time": ["t"],
        "temperature_2m": [25],
        "dew_point_2m": [8],
        "relative_humidity_2m": [40],
        "cloud_cover_low": [90],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [10],
        "geopotential_height_925hPa": [800]
    });
    assert_eq!(
        derive(&dry, 0, 649.0, "SCTB", Some(9999.0), false, false, None).clouds,
        "BKN///"
    );
}

#[test]
fn visibility_gust_and_nsw() {
    let vis = estimate_visibility_meters(98.0, 0.0);
    assert!(vis < 5000.0 && vis > 200.0);
    let hourly = json!({
        "time": ["2026-11-17T21:00", "2026-11-17T22:00", "2026-11-17T23:00"],
        "relative_humidity_2m": [55, 55, 55],
        "temperature_2m": [17, 17, 17],
        "dew_point_2m": [12, 12, 12],
        "pressure_msl": [1014, 1014, 1014],
        "wind_speed_10m": [8, 8, 8],
        "wind_direction_10m": [250, 250, 250],
        "wind_gusts_10m": [20, 20, 20],
        "precipitation": [0, 0, 0],
        "rain": [0, 0, 0],
        "showers": [0, 0, 0],
        "surface_pressure": [980, 980, 980],
        "cloud_cover_925hPa": [10, 10, 10],
        "geopotential_height_925hPa": [1200, 1200, 1200],
        "cloud_cover_850hPa": [5, 5, 5],
        "geopotential_height_850hPa": [1600, 1600, 1600]
    });
    let ecmwf = metar(
        "SCTB",
        649.0,
        "ecmwf_ifs025",
        "2026-11-17T20:43:00Z",
        "2026-11-17T21:00:00Z",
        &hourly,
        0,
    );
    assert!(ecmwf.raw.contains("VIS EST"));
    assert!(!ecmwf.raw.contains("////"));
    let ecmwf_taf = taf(
        "SCTB",
        649.0,
        "ecmwf_ifs025",
        "2026-11-17T20:43:00Z",
        &hourly,
    );
    assert!(!ecmwf_taf.raw.contains("////"));
    let observed = resolve_visibility_meters(
        &series(json!({"visibility": [3200], "relative_humidity_2m": [99]})),
        0,
        Some("gfs_seamless"),
    );
    assert!(!observed.estimated && observed.vis_m == Some(3200.0));
    assert_eq!(
        format_model_wind(Some(170.0), Some(20.0), Some(28.0)),
        "17011KT"
    );
    assert_eq!(
        format_model_wind(Some(170.0), Some(4.0), Some(26.0)),
        "VRB02G14KT"
    );

    let n = 8;
    let clearing = json!({
        "time": pad_hours(21, n),
        "relative_humidity_2m": vec![70.0; n],
        "temperature_2m": vec![17.0; n],
        "dew_point_2m": vec![14.0; n],
        "pressure_msl": vec![1014.0; n],
        "wind_speed_10m": [15, 15, 8, 8, 8, 8, 8, 8],
        "wind_direction_10m": [280, 280, 360, 360, 360, 360, 360, 360],
        "wind_gusts_10m": [30, 30, 12, 12, 12, 12, 12, 12],
        "precipitation": [0.5, 0.5, 0, 0, 0, 0, 0, 0],
        "rain": vec![0.0; n],
        "showers": [0.5, 0.5, 0, 0, 0, 0, 0, 0],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": [80, 80, 10, 10, 10, 10, 10, 10],
        "cloud_cover_925hPa": [80, 80, 10, 10, 10, 10, 10, 10],
        "geopotential_height_925hPa": vec![1200.0; n],
        "convective_cloud_base": [2200, 2200, -500, -500, -500, -500, -500, -500],
        "cloud_cover_850hPa": vec![20.0; n],
        "geopotential_height_850hPa": vec![1600.0; n],
        "cape": vec![200.0; n]
    });
    let clearing_taf = taf(
        "SCTB",
        649.0,
        "icon_seamless",
        "2026-11-17T20:43:00Z",
        &clearing,
    );
    let becmg = clearing_taf.raw.split("BECMG").nth(1).unwrap_or("");
    assert!(becmg.contains("NSW"));
    assert!(!becmg.contains("////"));
}

#[test]
fn vis_wx_thresholds_br_fg_and_vv_rules() {
    assert_eq!(vis_obscuration_wx(Some(800.0), Some(70.0), true), "FG");
    assert_eq!(vis_obscuration_wx(Some(800.0), Some(97.0), false), "");
    assert_eq!(vis_obscuration_wx(Some(1500.0), Some(90.0), false), "");
    assert_eq!(vis_obscuration_wx(Some(1500.0), Some(60.0), false), "HZ");
    assert_eq!(vis_obscuration_wx(Some(3000.0), Some(85.0), false), "BR");
    assert_eq!(vis_obscuration_wx(Some(3000.0), Some(60.0), false), "HZ");
    assert_eq!(vis_obscuration_wx(Some(5000.0), Some(85.0), false), "BR");
    assert_eq!(vis_obscuration_wx(Some(5000.0), Some(80.0), false), "BR");
    assert_eq!(vis_obscuration_wx(Some(5000.0), Some(60.0), false), "HZ");
    assert_eq!(vis_obscuration_wx(Some(5001.0), Some(95.0), true), "");
    assert_eq!(vis_obscuration_wx(Some(9999.0), Some(95.0), true), "");

    let base = json!({
        "time": ["t"],
        "temperature_2m": [12],
        "dew_point_2m": [10],
        "cloud_cover_low": [90],
        "cloud_cover_925hPa": [80],
        "geopotential_height_925hPa": [800],
        "surface_pressure": [980],
        "relative_humidity_2m": [85]
    });
    assert_eq!(
        derive(&base, 0, 649.0, "SCTB", Some(3000.0), false, false, None).weather,
        "BR"
    );
    assert_eq!(
        derive(&base, 0, 649.0, "SCTB", Some(3000.0), true, false, None).weather,
        "BR"
    );

    let n = 8;
    let br = json!({
        "time": pad_hours(17, n),
        "temperature_2m": vec![12.0; n],
        "dew_point_2m": vec![10.0; n],
        "relative_humidity_2m": vec![85.0; n],
        "pressure_msl": vec![1014.0; n],
        "wind_speed_10m": vec![16.0; n],
        "wind_direction_10m": vec![170.0; n],
        "wind_gusts_10m": vec![30.0; n],
        "visibility": [9999, 9999, 3000, 3000, 3000, 9999, 9999, 9999],
        "precipitation": vec![0.0; n],
        "rain": vec![0.0; n],
        "showers": vec![0.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": vec![90.0; n],
        "cloud_cover_925hPa": vec![80.0; n],
        "geopotential_height_925hPa": vec![1200.0; n],
        "cloud_cover_850hPa": vec![20.0; n],
        "geopotential_height_850hPa": vec![1600.0; n]
    });
    let br_taf = taf("SCTB", 649.0, "gfs_seamless", "2026-11-17T17:05:00Z", &br);
    let segments: Vec<&str> = br_taf
        .raw
        .split("BECMG")
        .skip(1)
        .filter(|part| part.contains("BR"))
        .collect();
    assert!(!segments.is_empty());
    for segment in segments {
        assert!(!segment.contains("NSW"));
    }

    let n = 5;
    let nsw = json!({
        "time": pad_hours(21, n),
        "temperature_2m": vec![17.0; n],
        "dew_point_2m": vec![14.0; n],
        "relative_humidity_2m": vec![70.0; n],
        "pressure_msl": vec![1014.0; n],
        "wind_speed_10m": [15, 15, 8, 8, 8],
        "wind_direction_10m": [280, 280, 360, 360, 360],
        "wind_gusts_10m": [30, 30, 12, 12, 12],
        "precipitation": [0.5, 0.5, 0, 0, 0],
        "rain": vec![0.0; n],
        "showers": [0.5, 0.5, 0, 0, 0],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": [80, 80, 10, 10, 10],
        "cloud_cover_925hPa": [80, 80, 10, 10, 10],
        "geopotential_height_925hPa": vec![1200.0; n],
        "convective_cloud_base": [2200, 2200, -500, -500, -500],
        "cloud_cover_850hPa": vec![20.0; n],
        "geopotential_height_850hPa": vec![1600.0; n],
        "cape": vec![200.0; n]
    });
    assert!(
        taf("SCTB", 649.0, "icon_seamless", "2026-11-17T20:43:00Z", &nsw)
            .raw
            .contains("NSW")
    );

    let floor = estimate_visibility_meters(98.0, 0.0);
    assert!(floor > 4000.0);
    let surface = json!({
        "time": ["2026-11-17T05:00"],
        "temperature_2m": [10],
        "dew_point_2m": [9.7],
        "relative_humidity_2m": [98],
        "wind_speed_10m": [4],
        "cloud_cover_low": [95],
        "surface_pressure": [980],
        "cloud_cover_925hPa": [90],
        "geopotential_height_925hPa": [649.0 + 20.0],
        "relative_humidity_925hPa": [98],
        "precipitation": [0],
        "rain": [0],
        "showers": [0]
    });
    assert!(ceil_of(&surface, 0, 649.0).obscured);
    let capped = derive(
        &surface,
        0,
        649.0,
        "SCTB",
        Some(crate::round::js_round(floor)),
        true,
        true,
        None,
    );
    assert!(capped.vis_m.unwrap() < 1000.0);
    assert_eq!(capped.weather, "FG");
    assert!(capped.clouds.starts_with("VV"));
    let surface_metar = metar(
        "SCTB",
        649.0,
        "ecmwf_ifs025",
        "2026-11-17T12:00:00Z",
        "2026-11-17T12:00:00Z",
        &surface,
        0,
    );
    assert!(surface_metar.raw.contains("FG") && surface_metar.raw.contains("VV000"));
    assert_est_only_in_trailing_rmk(&surface_metar.raw).unwrap();
    let mut day = surface.clone();
    day["time"] = json!(["2026-11-17T16:00"]);
    assert!(
        !derive(&day, 0, 649.0, "SCTB", Some(400.0), false, true, None)
            .weather
            .split_whitespace()
            .any(|token| token == "FG")
    );
    let mut windy = surface.clone();
    windy["wind_speed_10m"] = json!([20]);
    assert!(
        !derive(&windy, 0, 649.0, "SCTB", Some(400.0), false, true, None)
            .weather
            .split_whitespace()
            .any(|token| token == "FG")
    );
    let mut dry = surface.clone();
    dry["relative_humidity_925hPa"] = json!([40]);
    dry["relative_humidity_2m"] = json!([40]);
    assert!(
        !derive(&dry, 0, 649.0, "SCTB", Some(400.0), false, true, None)
            .weather
            .split_whitespace()
            .any(|token| token == "FG")
    );
    let mut wide = surface.clone();
    wide["dew_point_2m"] = json!([8.0]);
    assert!(
        !derive(&wide, 0, 649.0, "SCTB", Some(400.0), false, true, None)
            .weather
            .split_whitespace()
            .any(|token| token == "FG")
    );

    let manual = json!({
        "time": ["2026-11-17T05:00"],
        "temperature_2m": [11],
        "dew_point_2m": [10],
        "relative_humidity_2m": [90],
        "wind_speed_10m": [4],
        "cloud_cover_low": [90],
        "surface_pressure": [980],
        "geopotential_height_925hPa": [800],
        "relative_humidity_925hPa": [98],
        "precipitation": [0],
        "rain": [0],
        "showers": [0],
        "visibility": [800]
    });
    let sample = crate::ceiling::CeilingSample {
        ceiling_ft_agl: Some(400.0),
        ceiling_category: "LIFR",
        cloud_base_msl_m: Some(770.0),
        obscured: false,
        low_cloud_unresolved: false,
        method: crate::ceiling::CeilingMethod::Interpolated,
        vis_m: Some(800.0),
        cape_only_layer: None,
    };
    let manual_series = series(manual.clone());
    let with_layer = derive_metar_wx_and_cloud(
        &manual_series,
        0,
        649.0,
        "SCTB",
        &sample,
        Some(800.0),
        false,
        false,
        None,
    );
    assert!(cloud_code(&with_layer.clouds, "BKN") || cloud_code(&with_layer.clouds, "OVC"));
    assert!(!with_layer.clouds.contains("VV"));
    assert_eq!(with_layer.weather, "FG");
    let mut obscured_sample = sample;
    obscured_sample.obscured = true;
    let still_layer = derive_metar_wx_and_cloud(
        &manual_series,
        0,
        649.0,
        "SCTB",
        &obscured_sample,
        Some(800.0),
        false,
        false,
        None,
    );
    assert!(!still_layer.clouds.contains("VV"));

    let n = 6;
    let five_km = json!({
        "time": pad_hours(16, n),
        "temperature_2m": vec![12.0; n],
        "dew_point_2m": vec![10.0; n],
        "relative_humidity_2m": vec![85.0; n],
        "pressure_msl": vec![1014.0; n],
        "wind_speed_10m": vec![16.0; n],
        "wind_direction_10m": vec![180.0; n],
        "wind_gusts_10m": vec![20.0; n],
        "visibility": vec![5499.0; n],
        "precipitation": vec![0.0; n],
        "rain": vec![0.0; n],
        "showers": vec![0.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": vec![20.0; n],
        "cloud_cover_925hPa": vec![10.0; n],
        "geopotential_height_925hPa": vec![1600.0; n]
    });
    let five = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T16:10:00Z",
        &five_km,
    );
    assert!(five.raw.contains("5000 BR"));
    assert!(!five.raw.contains("NSW"));
}

#[test]
fn est_tokens_stay_after_rmk() {
    let metar_hourly = merge(
        json!({
            "time": ["2026-11-17T21:00"],
            "temperature_2m": [20],
            "dew_point_2m": [9],
            "pressure_msl": [1014],
            "relative_humidity_2m": [55],
            "wind_speed_10m": [8],
            "wind_direction_10m": [250],
            "wind_gusts_10m": [30],
            "precipitation": [0],
            "rain": [0],
            "showers": [0]
        }),
        unresolved(),
    );
    let metar = metar(
        "SCTB",
        649.0,
        "ecmwf_ifs025",
        "2026-11-17T20:00:00Z",
        "2026-11-17T21:00:00Z",
        &metar_hourly,
        0,
    );
    assert_est_only_in_trailing_rmk(&metar.raw).unwrap();
    assert!(metar.raw.contains("CLD EST") || metar.raw.contains("VIS EST"));
    let n = 6;
    let taf_hourly = json!({
        "time": pad_hours(21, n),
        "temperature_2m": vec![17.0; n],
        "dew_point_2m": vec![14.0; n],
        "pressure_msl": vec![1014.0; n],
        "relative_humidity_2m": vec![70.0; n],
        "wind_speed_10m": [15, 15, 8, 8, 8, 8],
        "wind_direction_10m": [280, 280, 360, 360, 360, 360],
        "wind_gusts_10m": [30, 30, 12, 12, 12, 12],
        "precipitation": [0.5, 0.5, 0, 0, 0, 0],
        "rain": vec![0.0; n],
        "showers": [0.5, 0.5, 0, 0, 0, 0],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": [80, 80, 10, 10, 10, 10],
        "cloud_cover_925hPa": [80, 80, 10, 10, 10, 10],
        "geopotential_height_925hPa": vec![1200.0; n],
        "convective_cloud_base": vec![2200.0; n],
        "cloud_cover_850hPa": vec![20.0; n],
        "geopotential_height_850hPa": vec![1600.0; n],
        "cape": vec![200.0; n]
    });
    let taf = taf(
        "SCTB",
        649.0,
        "icon_seamless",
        "2026-11-17T20:43:00Z",
        &taf_hourly,
    );
    assert_est_only_in_trailing_rmk(&taf.raw).unwrap();
    let body = taf.raw.split(" RMK ").next().unwrap();
    assert!(!body.split_whitespace().any(|token| token == "EST"));
}

fn hours_builder(count: usize, start: &str) -> Value {
    let time = times_from(start, count);
    let mut visibility = Vec::new();
    let mut wind_speed = Vec::new();
    let mut wind_dir = Vec::new();
    let mut cover925 = Vec::new();
    let mut cover850 = Vec::new();
    let mut surface = Vec::new();
    let mut precip = Vec::new();
    let mut rh = Vec::new();
    let mut rain = Vec::new();
    let mut showers = Vec::new();
    let mut h925 = Vec::new();
    let mut h850 = Vec::new();
    for index in 0..count {
        let low = if index < 8 { 70.0 } else { 5.0 };
        let cover = if index < 8 { 80.0 } else { 10.0 };
        visibility.push(if index < 3 { 6000.0 } else { 9999.0 });
        wind_speed.push(16.0);
        wind_dir.push(170.0 + (index % 2) as f64 * 10.0);
        cover925.push(cover);
        h925.push(1200.0);
        cover850.push(low);
        h850.push(1600.0);
        surface.push(980.0);
        precip.push(0.0);
        rh.push(55.0);
        rain.push(0.0);
        showers.push(0.0);
    }
    json!({
        "time": time,
        "visibility": visibility,
        "wind_speed_10m": wind_speed,
        "wind_direction_10m": wind_dir,
        "cloud_cover_925hPa": cover925,
        "geopotential_height_925hPa": h925,
        "cloud_cover_850hPa": cover850,
        "geopotential_height_850hPa": h850,
        "surface_pressure": surface,
        "precipitation": precip,
        "relative_humidity_2m": rh,
        "rain": rain,
        "showers": showers
    })
}

#[test]
fn taf_groups_validator_dd24_and_cross_midnight() {
    let mut built = fixture_hourly();
    let _ = &mut built;
    let result = taf(
        "SCEL",
        474.0,
        "gfs_seamless",
        "2026-11-17T11:00:00Z",
        &fixture_hourly(),
    );
    assert!(result.raw.starts_with(STAMP));
    assert!(result.raw.contains("TAF SCEL"));
    assert!(
        assert_model_taf_format(&result.raw).ok(),
        "{:?}",
        assert_model_taf_format(&result.raw).reasons()
    );

    let clearing = taf(
        "SCEL",
        474.0,
        "gfs_seamless",
        "2026-11-17T17:20:27Z",
        &hours_builder(30, "2026-11-17T11:00"),
    );
    assert!(clearing.raw.starts_with(STAMP));
    assert!(clearing.raw.matches("BECMG").count() <= 3);
    assert!(assert_model_taf_format(&clearing.raw).ok());

    let next_hour = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T17:20:27Z",
        &hours_builder(30, "2026-11-17T16:00"),
    );
    assert!(next_hour.raw.contains("1718/1818"));

    let mut calm = hours_builder(24, "2026-11-17T12:00");
    for index in 0..24 {
        calm["wind_speed_10m"][index] = json!(0);
        calm["wind_direction_10m"][index] = json!(180);
    }
    assert!(
        taf("SCTB", 649.0, "gfs_seamless", "2026-11-17T22:00:00Z", &calm)
            .raw
            .contains("00000KT")
    );

    let mut noisy = hours_builder(24, "2026-11-17T12:00");
    for index in 0..24 {
        noisy["wind_speed_10m"][index] = json!(16);
        noisy["wind_direction_10m"][index] = json!(170 + (index % 3) * 15);
        noisy["visibility"][index] = json!(9999);
        noisy["cloud_cover_925hPa"][index] = json!(5);
    }
    assert!(
        taf(
            "SCTB",
            649.0,
            "gfs_seamless",
            "2026-11-17T10:00:00Z",
            &noisy
        )
        .raw
        .matches("BECMG")
        .count()
            <= 2
    );

    let n = 10;
    let mut rh = Vec::new();
    for index in 0..n {
        rh.push(if index % 2 == 0 { 85.0 } else { 60.0 });
    }
    let alternate = json!({
        "time": pad_hours(16, n),
        "temperature_2m": vec![12.0; n],
        "dew_point_2m": vec![8.0; n],
        "relative_humidity_2m": rh,
        "pressure_msl": vec![1014.0; n],
        "wind_speed_10m": vec![16.0; n],
        "wind_direction_10m": vec![180.0; n],
        "wind_gusts_10m": vec![20.0; n],
        "visibility": vec![4000.0; n],
        "precipitation": vec![0.0; n],
        "rain": vec![0.0; n],
        "showers": vec![0.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": vec![80.0; n],
        "cloud_cover_925hPa": vec![80.0; n],
        "geopotential_height_925hPa": vec![1200.0; n],
        "cloud_cover_850hPa": vec![20.0; n],
        "geopotential_height_850hPa": vec![1600.0; n]
    });
    let alternate_taf = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T16:10:00Z",
        &alternate,
    );
    assert_eq!(alternate_taf.raw.matches("BECMG").count(), 0);
    assert!(!alternate_taf.raw.contains("NSW"));

    let n = 8;
    let mut showers = vec![0.0; n];
    let mut rain = vec![0.0; n];
    let mut precip = vec![0.0; n];
    showers[4] = 0.8;
    precip[4] = 0.8;
    rain[6] = 0.3;
    precip[6] = 0.3;
    let mixed = json!({
        "time": pad_hours(16, n),
        "temperature_2m": vec![12.0; n],
        "dew_point_2m": vec![10.0; n],
        "relative_humidity_2m": vec![70.0; n],
        "pressure_msl": vec![1014.0; n],
        "wind_speed_10m": vec![16.0; n],
        "wind_direction_10m": vec![180.0; n],
        "wind_gusts_10m": vec![20.0; n],
        "visibility": vec![9000.0; n],
        "precipitation": precip,
        "rain": rain,
        "showers": showers,
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": vec![30.0; n],
        "cloud_cover_925hPa": vec![20.0; n],
        "geopotential_height_925hPa": vec![1600.0; n],
        "cloud_cover_850hPa": vec![10.0; n],
        "geopotential_height_850hPa": vec![2200.0; n]
    });
    let mixed_taf = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T16:10:00Z",
        &mixed,
    );
    assert!(mixed_taf.raw.contains("TEMPO") && mixed_taf.raw.contains("-SHRA"));
    assert!(!mixed_taf.raw.contains("-RA"));

    let mut low = vec![10.0; n];
    low[4] = 90.0;
    low[5] = 90.0;
    low[6] = 90.0;
    let estimated = json!({
        "time": pad_hours(16, n),
        "temperature_2m": vec![26.0; n],
        "dew_point_2m": vec![9.0; n],
        "relative_humidity_2m": vec![35.0; n],
        "pressure_msl": vec![1014.0; n],
        "wind_speed_10m": [16, 16, 16, 16, 40, 40, 40, 16],
        "wind_direction_10m": vec![180.0; n],
        "wind_gusts_10m": vec![20.0; n],
        "visibility": vec![9999.0; n],
        "precipitation": vec![0.0; n],
        "rain": vec![0.0; n],
        "showers": vec![0.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": low,
        "cloud_cover_925hPa": vec![10.0; n],
        "geopotential_height_925hPa": vec![800.0; n],
        "cloud_cover_850hPa": vec![10.0; n],
        "geopotential_height_850hPa": vec![1600.0; n]
    });
    let estimated_taf = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T16:10:00Z",
        &estimated,
    );
    let (body, rmk) = estimated_taf.raw.split_once(" RMK ").unwrap();
    assert!(body.contains("BECMG") && body.contains("BKN050"));
    assert!(!body.split_whitespace().any(|token| token == "EST"));
    assert!(rmk.contains("CLD EST"));

    let n = 20;
    let time = times_from("2026-11-17T12:00", n);
    let br_long = json!({
        "time": time,
        "temperature_2m": vec![12.0; n],
        "dew_point_2m": (0..n).map(|i| if (2..=14).contains(&i) { 10.0 } else { 1.0 }).collect::<Vec<_>>(),
        "relative_humidity_2m": (0..n).map(|i| if (2..=14).contains(&i) { 85.0 } else { 40.0 }).collect::<Vec<_>>(),
        "pressure_msl": vec![1014.0; n],
        "wind_speed_10m": vec![16.0; n],
        "wind_direction_10m": vec![180.0; n],
        "wind_gusts_10m": vec![18.0; n],
        "visibility": (0..n).map(|i| if (2..=14).contains(&i) { 5000.0 } else { 9999.0 }).collect::<Vec<_>>(),
        "precipitation": vec![0.0; n],
        "rain": vec![0.0; n],
        "showers": vec![0.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": vec![10.0; n],
        "cloud_cover_925hPa": vec![10.0; n],
        "geopotential_height_925hPa": vec![1600.0; n]
    });
    let long_taf = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T12:00:00Z",
        &br_long,
    );
    let windows = becmg_windows(&long_taf.raw);
    assert!(!windows.is_empty());
    for (from, to) in &windows {
        let span = ddhh_span_hours(from, to);
        assert!(span > 0 && span <= 2, "{from}/{to}");
    }
    assert!(long_taf.raw.contains("BECMG 1714/1716") && long_taf.raw.contains("BR"));
    let check = assert_model_taf_format(&long_taf.raw);
    assert!(check.ok());
    assert!(check.warnings().is_empty());

    let n = 8;
    let br_tempo = json!({
        "time": pad_hours(12, n),
        "temperature_2m": vec![12.0; n],
        "dew_point_2m": (0..n).map(|i| if i == 2 || i == 3 { 10.0 } else { 1.0 }).collect::<Vec<_>>(),
        "relative_humidity_2m": (0..n).map(|i| if i == 2 || i == 3 { 85.0 } else { 40.0 }).collect::<Vec<_>>(),
        "pressure_msl": vec![1014.0; n],
        "wind_speed_10m": vec![16.0; n],
        "wind_direction_10m": vec![180.0; n],
        "wind_gusts_10m": vec![18.0; n],
        "visibility": (0..n).map(|i| if i == 2 || i == 3 { 3000.0 } else { 9999.0 }).collect::<Vec<_>>(),
        "precipitation": vec![0.0; n],
        "rain": vec![0.0; n],
        "showers": vec![0.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": vec![10.0; n],
        "cloud_cover_925hPa": vec![10.0; n],
        "geopotential_height_925hPa": vec![1600.0; n]
    });
    let tempo = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T12:00:00Z",
        &br_tempo,
    );
    assert!(tempo.raw.contains("TEMPO 1714/1716"));
    assert!(!tempo.raw.contains("TEMPO 1715/1716"));

    let head = "MODEL OUTPUT \u{2014} NOT OFFICIAL\nTAF SCTB 171200Z 1712/1812 18008KT 9999 NSC";
    let over = assert_model_taf_format(&format!(
        "{head} BECMG 1712/1718 18008KT 9999 NSC RMK GEN=x"
    ));
    assert!(!over.ok());
    assert!(over.reasons().join(" ").contains("never over 4 h"));
    let warn = assert_model_taf_format(&format!(
        "{head} BECMG 1712/1715 18008KT 9999 NSC RMK GEN=x"
    ));
    assert!(warn.ok());
    assert!(warn.warnings().join(" ").contains("normally 2 h or less"));
    let ok = assert_model_taf_format(&format!(
        "{head} BECMG 1712/1714 18008KT 9999 NSC RMK GEN=x"
    ));
    assert!(ok.ok() && ok.warnings().is_empty());

    let n = 36;
    let time = times_from("2026-11-17T18:00:00Z", n);
    let wind: Vec<f64> = time
        .iter()
        .map(|stamp| {
            if stamp.as_str() >= "2026-11-18T23:00" {
                50.0
            } else {
                18.0
            }
        })
        .collect();
    let clamped = json!({
        "time": time,
        "temperature_2m": vec![16.0; n],
        "dew_point_2m": vec![6.0; n],
        "relative_humidity_2m": vec![40.0; n],
        "visibility": vec![9999.0; n],
        "wind_speed_10m": wind.clone(),
        "wind_direction_10m": vec![200.0; n],
        "wind_gusts_10m": wind,
        "precipitation": vec![0.0; n],
        "rain": vec![0.0; n],
        "showers": vec![0.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": vec![5.0; n],
        "cloud_cover_925hPa": vec![5.0; n],
        "geopotential_height_925hPa": vec![1600.0; n]
    });
    let clamped_taf = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-17T23:17:00Z",
        &clamped,
    );
    assert!(clamped_taf.raw.contains("1800/1824"));
    assert!(clamped_taf.raw.contains("BECMG 1823/1824"));
    assert!(!clamped_taf.raw.contains("/1900"));
    assert!(assert_model_taf_format(&clamped_taf.raw).ok());

    let from = UtcStamp::from_parts(2026, 10, 18, 12, 0, 0, 0);
    let midnight = UtcStamp::from_parts(2026, 10, 19, 0, 0, 0, 0);
    assert_eq!(
        format!("{}/{}", taf_ddhh(from), taf_validity_end(from, midnight)),
        "1812/1824"
    );
    let next_noon = UtcStamp::from_parts(2026, 10, 19, 12, 0, 0, 0);
    assert_eq!(
        format!("{}/{}", taf_ddhh(from), taf_validity_end(from, next_noon)),
        "1812/1912"
    );

    let head = "MODEL OUTPUT \u{2014} NOT OFFICIAL\nTAF SCTB 172317Z 1800/1824 VRB01KT 9999 NSC";
    let past = assert_model_taf_format(&format!(
        "{head} BECMG 1822/1902 18008KT 9999 NSC RMK GEN=x"
    ));
    assert!(past
        .reasons()
        .join(" ")
        .contains("outside validity 1800/1824"));
    let midnight = assert_model_taf_format(&format!(
        "{head} BECMG 1823/1900 VRB01KT 9999 NSC RMK GEN=x"
    ));
    assert!(midnight.reasons().join(" ").contains("1823/1900"));
    let bad_period = assert_model_taf_format(
        "MODEL OUTPUT \u{2014} NOT OFFICIAL\nTAF SCTB 181100Z 1812/1900 18008KT 9999 NSC RMK GEN=x",
    );
    assert!(bad_period.reasons().join(" ").contains("1812/1900"));
    assert!(assert_model_taf_format(
        "MODEL OUTPUT \u{2014} NOT OFFICIAL\nTAF SCTB 181100Z 1812/1912 18008KT 9999 NSC RMK GEN=x"
    )
    .ok());
    assert!(assert_model_taf_format(&format!(
        "{head} BECMG 1823/1824 VRB01KT 9999 NSC RMK GEN=x"
    ))
    .ok());

    let n = 30;
    let time = times_from("2026-11-18T12:00:00Z", n);
    let wind: Vec<f64> = time
        .iter()
        .map(|stamp| {
            if stamp.as_str() >= "2026-11-18T23:00" {
                50.0
            } else {
                18.0
            }
        })
        .collect();
    let cross = json!({
        "time": time,
        "temperature_2m": vec![16.0; n],
        "dew_point_2m": vec![6.0; n],
        "relative_humidity_2m": vec![40.0; n],
        "visibility": vec![9999.0; n],
        "wind_speed_10m": wind.clone(),
        "wind_direction_10m": vec![200.0; n],
        "wind_gusts_10m": wind,
        "precipitation": vec![0.0; n],
        "rain": vec![0.0; n],
        "showers": vec![0.0; n],
        "surface_pressure": vec![980.0; n],
        "cloud_cover_low": vec![5.0; n],
        "cloud_cover_925hPa": vec![5.0; n],
        "geopotential_height_925hPa": vec![1600.0; n]
    });
    let cross_taf = taf(
        "SCTB",
        649.0,
        "gfs_seamless",
        "2026-11-18T11:17:00Z",
        &cross,
    );
    assert!(cross_taf.raw.contains("1812/1912"));
    assert!(cross_taf.raw.contains("BECMG 1823/1901"));
    assert!(!cross_taf.raw.contains("BECMG 1823/1824"));
    assert!(!cross_taf.raw.contains("/1900"));
    assert!(
        assert_model_taf_format(&cross_taf.raw).ok(),
        "{:?}",
        assert_model_taf_format(&cross_taf.raw).reasons()
    );
    let head = "MODEL OUTPUT \u{2014} NOT OFFICIAL\nTAF SCTB 181117Z 1812/1912 20010KT 9999 NSC";
    assert!(assert_model_taf_format(&format!(
        "{head} BECMG 1823/1901 20027KT 9999 NSC RMK GEN=x"
    ))
    .ok());
    let as00 = assert_model_taf_format(&format!(
        "{head} BECMG 1823/1900 20027KT 9999 NSC RMK GEN=x"
    ));
    assert!(as00.reasons().join(" ").contains("1823/1900"));
    assert!(assert_model_taf_format(&format!(
        "{head} BECMG 1823/1824 20010KT 9999 NSC RMK GEN=x"
    ))
    .ok());
    let bad = assert_model_taf_format(
        "MODEL OUTPUT \u{2014} NOT OFFICIAL\nTAF SCTB 181117Z 1812/1900 20010KT 9999 NSC RMK GEN=x",
    );
    assert!(bad.reasons().join(" ").contains("1812/1900"));
}
