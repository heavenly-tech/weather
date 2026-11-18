//! NOAA Aviation Weather Center METAR and TAF rows.
//!
//! Visibility prefers the ICAO metre group in the raw text. `visib` is statute
//! miles (`6+`, `3.11`) and snaps to the usual reporting steps. A missing
//! `fltCat` is derived from visibility and the lowest BKN/OVC/VV base.

use serde_json::Value;

use crate::round::js_round;
use crate::utc::UtcStamp;

const SM_TO_M: f64 = 1609.344;

#[derive(Clone, Debug)]
pub struct CloudLayer {
    pub cover: String,
    pub base_ft: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct MetarObs {
    pub icao: String,
    pub name: String,
    pub raw: String,
    pub observed_at: Option<String>,
    pub temp_c: Option<f64>,
    pub dewpoint_c: Option<f64>,
    pub wind_dir_deg: Option<f64>,
    pub wind_kt: Option<f64>,
    pub gust_kt: Option<f64>,
    pub vis_m: Option<f64>,
    pub altimeter_hpa: Option<f64>,
    pub flight_category: String,
    pub cover: Option<String>,
    pub clouds: Vec<CloudLayer>,
    pub lat: f64,
    pub lon: f64,
    pub elev_m: Option<f64>,
    pub ceiling_ft: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct TafPeriod {
    pub from: Option<String>,
    pub to: Option<String>,
    pub change: Option<String>,
    pub probability: Option<f64>,
    pub wind_dir_deg: Option<f64>,
    pub wind_kt: Option<f64>,
    pub vis_m: Option<f64>,
    pub wx: Option<String>,
    pub clouds: Vec<CloudLayer>,
    pub flight_category: String,
}

#[derive(Clone, Debug)]
pub struct TafObs {
    pub icao: String,
    pub name: String,
    pub raw: String,
    pub issued_at: Option<String>,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub periods: Vec<TafPeriod>,
    pub lat: f64,
    pub lon: f64,
    pub ceiling_ft: Option<f64>,
}

pub fn parse_metar(row: &Value) -> MetarObs {
    let icao = text(row, "icaoId").unwrap_or_default().to_ascii_uppercase();
    let name = text(row, "name")
        .map(str::to_string)
        .or_else(|| text(row, "icaoId").map(str::to_string))
        .unwrap_or_else(|| "Unknown station".to_string());
    let raw = text(row, "rawOb").unwrap_or("").to_string();
    let clouds = clouds(row.get("clouds"));
    let vis_m = resolve_vis_m(Some(&raw), row.get("visib"));
    let ceiling_ft = ceiling_ft_from_clouds(&clouds);
    let from_awc = flight_cat(text(row, "fltCat"));
    let flight_category = if from_awc == "UNK" {
        flight_category_from_wx(vis_m, ceiling_ft)
    } else {
        from_awc
    };
    let observed_at = text(row, "reportTime")
        .map(str::to_string)
        .or_else(|| unix_to_iso(row.get("obsTime").and_then(Value::as_f64)));
    MetarObs {
        icao,
        name,
        raw,
        observed_at,
        temp_c: num(row, "temp"),
        dewpoint_c: num(row, "dewp"),
        wind_dir_deg: wind_dir(row.get("wdir")),
        wind_kt: num(row, "wspd"),
        gust_kt: num(row, "wgst"),
        vis_m,
        altimeter_hpa: num(row, "altim"),
        flight_category,
        cover: text(row, "cover").map(str::to_string),
        clouds,
        lat: num(row, "lat").unwrap_or(0.0),
        lon: num(row, "lon").unwrap_or(0.0),
        elev_m: num(row, "elev"),
        ceiling_ft,
    }
}

pub fn parse_taf(row: &Value) -> TafObs {
    let icao = text(row, "icaoId").unwrap_or_default().to_ascii_uppercase();
    let name = text(row, "name")
        .map(str::to_string)
        .or_else(|| text(row, "icaoId").map(str::to_string))
        .unwrap_or_else(|| "Unknown station".to_string());
    let periods = row
        .get("fcsts")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().map(parse_period).collect::<Vec<_>>())
        .unwrap_or_default();
    let ceiling_ft = lowest_period_ceiling(&periods);
    TafObs {
        icao,
        name,
        raw: text(row, "rawTAF").unwrap_or("").to_string(),
        issued_at: text(row, "issueTime").map(str::to_string),
        valid_from: unix_to_iso(row.get("validTimeFrom").and_then(Value::as_f64)),
        valid_to: unix_to_iso(row.get("validTimeTo").and_then(Value::as_f64)),
        periods,
        lat: num(row, "lat").unwrap_or(0.0),
        lon: num(row, "lon").unwrap_or(0.0),
        ceiling_ft,
    }
}

fn parse_period(row: &Value) -> TafPeriod {
    let clouds = clouds(row.get("clouds"));
    let vis_m = awc_vis_to_meters(row.get("visib"));
    let ceiling_ft = ceiling_ft_from_clouds(&clouds);
    TafPeriod {
        from: unix_to_iso(row.get("timeFrom").and_then(Value::as_f64)),
        to: unix_to_iso(row.get("timeTo").and_then(Value::as_f64)),
        change: nullable_text(row, "fcstChange"),
        probability: num(row, "probability"),
        wind_dir_deg: wind_dir(row.get("wdir")),
        wind_kt: num(row, "wspd"),
        vis_m,
        wx: nullable_text(row, "wxString"),
        clouds,
        flight_category: flight_category_from_wx(vis_m, ceiling_ft),
    }
}

fn lowest_period_ceiling(periods: &[TafPeriod]) -> Option<f64> {
    let mut best: Option<f64> = None;
    for period in periods {
        if let Some(base) = ceiling_ft_from_clouds(&period.clouds) {
            best = Some(best.map(|current| current.min(base)).unwrap_or(base));
        }
    }
    best
}

pub fn ceiling_ft_from_clouds(clouds: &[CloudLayer]) -> Option<f64> {
    let mut best: Option<f64> = None;
    for cloud in clouds {
        let cover = cloud.cover.to_ascii_uppercase();
        if cover != "BKN" && cover != "OVC" && cover != "VV" {
            continue;
        }
        let Some(base) = cloud.base_ft else {
            continue;
        };
        best = Some(best.map(|current| current.min(base)).unwrap_or(base));
    }
    best
}

fn clouds(value: Option<&Value>) -> Vec<CloudLayer> {
    value
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .map(|cloud| CloudLayer {
                    cover: text(cloud, "cover").unwrap_or("SKC").to_string(),
                    base_ft: num(cloud, "base"),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn flight_cat(value: Option<&str>) -> String {
    match value {
        Some(cat @ ("VFR" | "MVFR" | "IFR" | "LIFR")) => cat.to_string(),
        _ => "UNK".to_string(),
    }
}

pub fn flight_category_from_wx(vis_m: Option<f64>, ceiling_ft: Option<f64>) -> String {
    let vis = vis_m.unwrap_or(f64::INFINITY);
    let ceil = ceiling_ft.unwrap_or(f64::INFINITY);
    if ceil < 500.0 || vis < SM_TO_M {
        "LIFR"
    } else if ceil < 1000.0 || vis < 3.0 * SM_TO_M {
        "IFR"
    } else if ceil <= 3000.0 || vis <= 5.0 * SM_TO_M {
        "MVFR"
    } else {
        "VFR"
    }
    .to_string()
}

fn resolve_vis_m(raw: Option<&str>, visib: Option<&Value>) -> Option<f64> {
    parse_icao_vis_m(raw).or_else(|| awc_vis_to_meters(visib))
}

fn parse_icao_vis_m(raw: Option<&str>) -> Option<f64> {
    let raw = raw?;
    if raw.is_empty() {
        return None;
    }
    if has_word(raw, "CAVOK") {
        return Some(9999.0);
    }
    let slice = after_wind(raw).unwrap_or(raw);
    if has_word(slice, "CAVOK") {
        return Some(9999.0);
    }
    four_digit_vis(slice)
}

fn after_wind(raw: &str) -> Option<&str> {
    let bytes = raw.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if let Some(end) = wind_group_end(bytes, index) {
            let mut cursor = end;
            while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }
            return Some(&raw[cursor..]);
        }
        index += 1;
    }
    None
}

fn wind_group_end(bytes: &[u8], start: usize) -> Option<usize> {
    let rest = bytes.get(start..)?;
    let digits = rest.len() >= 3 && rest[..3].iter().all(u8::is_ascii_digit);
    let mut index = if rest.starts_with(b"VRB") || digits {
        3
    } else {
        return None;
    };
    let speed = rest
        .get(index..)?
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    if !(2..=3).contains(&speed) {
        return None;
    }
    index += speed;
    if rest.get(index) == Some(&b'G') {
        let gust = rest
            .get(index + 1..)?
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        if !(2..=3).contains(&gust) {
            return None;
        }
        index += 1 + gust;
    }
    let unit = rest.get(index..)?;
    let unit_len = if unit.starts_with(b"KT") || unit.starts_with(b"MPS") {
        if unit.starts_with(b"KT") {
            2
        } else {
            3
        }
    } else if unit.starts_with(b"KMH") {
        3
    } else {
        return None;
    };
    let end = start + index + unit_len;
    if start > 0 && bytes[start - 1].is_ascii_alphanumeric() {
        return None;
    }
    Some(end)
}

fn four_digit_vis(slice: &str) -> Option<f64> {
    let bytes = slice.as_bytes();
    let mut index = 0;
    while index + 4 <= bytes.len() {
        if index > 0 && is_word(bytes[index - 1]) {
            index += 1;
            continue;
        }
        if bytes[index..index + 4].iter().all(u8::is_ascii_digit) {
            let after = index + 4;
            let suffix = suffix_len(&bytes[after..]);
            let end = after + suffix;
            if end < bytes.len() && is_word(bytes[end]) {
                index += 1;
                continue;
            }
            let meters: f64 = slice[index..after].parse().ok()?;
            if meters <= 9999.0 {
                return Some(meters);
            }
        }
        index += 1;
    }
    None
}

fn suffix_len(bytes: &[u8]) -> usize {
    if bytes.starts_with(b"NDV") {
        return 3;
    }
    let dirs = bytes
        .iter()
        .take(2)
        .take_while(|byte| matches!(byte, b'N' | b'S' | b'E' | b'W'))
        .count();
    if dirs > 0 {
        dirs
    } else {
        0
    }
}

fn has_word(text: &str, word: &str) -> bool {
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .any(|token| token == word)
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
}

fn awc_vis_to_meters(value: Option<&Value>) -> Option<f64> {
    let text = match value {
        None | Some(Value::Null) => return None,
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Number(number)) => number.to_string(),
        _ => return None,
    };
    if text.is_empty() {
        return None;
    }
    if text == "6+" || text.to_ascii_lowercase().starts_with("p6") {
        return Some(9999.0);
    }
    let sm: f64 = text.parse().ok()?;
    if !sm.is_finite() || sm < 0.0 {
        return None;
    }
    let meters = sm * SM_TO_M;
    if meters >= 9990.0 {
        return Some(9999.0);
    }
    if meters < 800.0 {
        return Some(js_round(meters / 50.0) * 50.0);
    }
    if meters < 5000.0 {
        return Some(js_round(meters / 100.0) * 100.0);
    }
    Some(9999.0_f64.min(js_round(meters / 1000.0) * 1000.0))
}

pub fn unix_to_iso(unix: Option<f64>) -> Option<String> {
    let unix = unix?;
    if !unix.is_finite() {
        return None;
    }
    let ms = if unix > 1e12 { unix } else { unix * 1000.0 };
    Some(UtcStamp::from_epoch_ms(ms.trunc() as i64).to_iso())
}

fn text<'a>(row: &'a Value, key: &str) -> Option<&'a str> {
    row.get(key).and_then(Value::as_str)
}

fn nullable_text(row: &Value, key: &str) -> Option<String> {
    match row.get(key) {
        Some(Value::String(text)) => Some(text.clone()),
        _ => None,
    }
}

fn num(row: &Value, key: &str) -> Option<f64> {
    match row.get(key)? {
        Value::Number(number) => number.as_f64().filter(|value| value.is_finite()),
        Value::String(text) => text.parse().ok().filter(|value: &f64| value.is_finite()),
        _ => None,
    }
}

fn wind_dir(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64().filter(|item| item.is_finite()),
        Value::String(text) => text.parse().ok().filter(|item: &f64| item.is_finite()),
        _ => None,
    }
}
