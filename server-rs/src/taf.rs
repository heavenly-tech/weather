//! Generated TAF.
//!
//! A light `BR` / `HZ` / `-RA` / `-DZ` flip shorter than 2 h is dropped. At
//! 2 h it becomes a `BECMG` ending at `min(i + 2, runEnd)`, clamped to the
//! validity end. Midnight is `DD24`, never `DD00`. A short new shower is
//! `TEMPO`. `NSW` clears weather that has ended.

use crate::annex3::{
    ceil_significant, kmh_to_kt, round_vis_taf, round_vis_taf_meters, vis_significant,
    wind_significant, wx_significant, WxSample,
};
use crate::ceiling::ceiling_from_hourly;
use crate::metar::{format_model_wind, ModelProduct, STAMP};
use crate::metar_wx::derive_metar_wx_and_cloud;
use crate::series::Series;
use crate::utc::{parse_utc_iso, UtcStamp};
use crate::visibility::resolve_visibility_meters;

#[derive(Clone, Debug)]
struct PeriodWx {
    wind: String,
    vis: String,
    cloud: String,
    wx: String,
    ceil_ft: Option<f64>,
    dir: Option<f64>,
    kt: Option<f64>,
    vis_m: Option<f64>,
    cld_estimated: bool,
}

fn period_wx(series: &Series, index: usize, elev_m: f64, model: &str, icao: &str) -> PeriodWx {
    let ceil = ceiling_from_hourly(&series.hourly, index, elev_m);
    let resolved = resolve_visibility_meters(series, index, Some(model));
    let vis_round = resolved.vis_m.map(round_vis_taf_meters);
    let wind = format_model_wind(
        series.num("wind_direction_10m", index),
        series.num("wind_speed_10m", index),
        series.num("wind_gusts_10m", index),
    );
    let derived = derive_metar_wx_and_cloud(
        series,
        index,
        elev_m,
        icao,
        &ceil,
        vis_round,
        true,
        resolved.estimated,
        Some(model),
    );
    let vis_m = derived.vis_m.or(resolved.vis_m);
    let vis = match vis_m {
        Some(vis) => round_vis_taf(vis),
        None => "9999".to_string(),
    };
    PeriodWx {
        wind,
        vis,
        cloud: derived.clouds,
        wx: derived.weather,
        ceil_ft: derived.effective_ceil_ft.or(ceil.ceiling_ft_agl),
        dir: series.num("wind_direction_10m", index),
        kt: kmh_to_kt(series.num("wind_speed_10m", index)),
        vis_m,
        cld_estimated: derived.cld_estimated,
    }
}

const CHURN_TOKENS: [&str; 4] = ["BR", "HZ", "-RA", "-DZ"];

fn has_shower_wx(wx: &str) -> bool {
    let bytes = wx.as_bytes();
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
            if bytes[rest..].starts_with(b"SH") {
                return true;
            }
        }
        index += 1;
    }
    false
}

fn contains_word(text: &str, word: &str) -> bool {
    let bytes = text.as_bytes();
    let needle = word.as_bytes();
    let mut index = 0;
    while index + needle.len() <= bytes.len() {
        let start_ok = index == 0 || !is_word(bytes[index - 1]);
        let end = index + needle.len();
        let end_ok = end == bytes.len() || !is_word(bytes[end]);
        if start_ok && end_ok && &bytes[index..end] == needle {
            return true;
        }
        index += 1;
    }
    false
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn light_wx_churn_only(a: &PeriodWx, b: &PeriodWx) -> bool {
    if wind_significant(a.dir, a.kt, b.dir, b.kt)
        || vis_significant(a.vis_m, b.vis_m)
        || ceil_significant(a.ceil_ft, b.ceil_ft)
        || a.wx == b.wx
        || has_shower_wx(&a.wx)
        || has_shower_wx(&b.wx)
        || contains_word(&a.wx, "FG")
        || contains_word(&b.wx, "FG")
    {
        return false;
    }
    let ok = |wx: &str| {
        wx.split_whitespace()
            .all(|token| CHURN_TOKENS.contains(&token))
    };
    ok(&a.wx) && ok(&b.wx)
}

fn group_string(wx: &PeriodWx, prior_wx: Option<&str>) -> String {
    let mut parts = vec![wx.wind.clone(), wx.vis.clone()];
    if !wx.wx.is_empty() {
        parts.push(wx.wx.clone());
    }
    if prior_wx.is_some_and(|prior| !prior.is_empty()) && wx.wx.is_empty() {
        parts.push("NSW".to_string());
    }
    parts.push(wx.cloud.clone());
    parts.retain(|part| !part.is_empty());
    parts.join(" ")
}

fn sample(wx: &PeriodWx) -> WxSample {
    WxSample {
        dir: wx.dir,
        kt: wx.kt,
        vis_m: wx.vis_m,
        ceil_ft: wx.ceil_ft,
        wx: wx.wx.clone(),
    }
}

pub fn taf_ddhhmmz(iso: &str) -> Result<String, String> {
    let stamp = parse_utc_iso(iso)?;
    let parts = stamp.parts();
    Ok(format!(
        "{:02}{:02}{:02}Z",
        parts.day, parts.hour, parts.minute
    ))
}

pub fn taf_ddhh(stamp: UtcStamp) -> String {
    let parts = stamp.parts();
    format!("{:02}{:02}", parts.day, parts.hour)
}

/// Midnight is hour 24 of the previous day (`1824`, never `1900`).
pub fn taf_end_token(at: UtcStamp) -> String {
    let parts = at.parts();
    if parts.hour == 0 && parts.minute == 0 && parts.second == 0 {
        let previous =
            UtcStamp::from_parts(parts.year, parts.month0, parts.day as i32 - 1, 0, 0, 0, 0);
        return format!("{:02}24", previous.parts().day);
    }
    format!("{:02}{:02}", parts.day, parts.hour)
}

pub fn taf_validity_end(_from: UtcStamp, to: UtcStamp) -> String {
    taf_end_token(to)
}

fn change_window(start: UtcStamp, end_raw: UtcStamp, valid_to: UtcStamp) -> Option<String> {
    if start.epoch_ms() >= valid_to.epoch_ms() {
        return None;
    }
    let end = if end_raw.epoch_ms() > valid_to.epoch_ms() {
        valid_to
    } else {
        end_raw
    };
    if end.epoch_ms() <= start.epoch_ms() {
        return None;
    }
    let from = taf_ddhh(start);
    let to = taf_end_token(end);
    if from == to {
        None
    } else {
        Some(format!("{from}/{to}"))
    }
}

pub fn validity_from_issue(issue: UtcStamp) -> (UtcStamp, UtcStamp) {
    let parts = issue.parts();
    let hour = if parts.minute > 0 || parts.second > 0 {
        parts.hour as i32 + 1
    } else {
        parts.hour as i32
    };
    let from = UtcStamp::from_parts(parts.year, parts.month0, parts.day as i32, hour, 0, 0, 0);
    (from, from.plus_hours(24))
}

fn last_index_before(times: &[UtcStamp], end: UtcStamp) -> usize {
    let mut last = 0;
    for (index, time) in times.iter().enumerate() {
        if time.epoch_ms() <= end.epoch_ms() {
            last = index;
        }
    }
    last
}

struct Change {
    order: i64,
    text: String,
}

pub fn generate_model_taf(
    icao: &str,
    elev_m: f64,
    model: &str,
    run_time: &str,
    series: &Series,
) -> Result<ModelProduct, String> {
    if series.time.len() < 2 {
        return Err("Insufficient model hours for TAF".to_string());
    }
    let times = series
        .time
        .iter()
        .map(|stamp| parse_utc_iso(stamp))
        .collect::<Result<Vec<_>, _>>()?;
    let issue = parse_utc_iso(run_time)?;
    let (valid_from, valid_to) = validity_from_issue(issue);
    let from_idx = times
        .iter()
        .position(|time| time.epoch_ms() >= valid_from.epoch_ms());
    let base_idx = from_idx.unwrap_or(0);
    let end_idx = last_index_before(&times, valid_to);
    if end_idx <= base_idx {
        return Err("Validity window outside model hours".to_string());
    }

    let base = period_wx(series, base_idx, elev_m, model, icao);
    let vis_estimated = resolve_visibility_meters(series, base_idx, Some(model)).estimated;
    let base_group = group_string(&base, None);
    let header = format!(
        "TAF {icao} {} {}/{}",
        taf_ddhhmmz(run_time)?,
        taf_ddhh(valid_from),
        taf_validity_end(valid_from, valid_to)
    );
    let mut changes = Vec::new();
    let mut cld_estimated = base.cld_estimated;
    let mut prevailing = base;
    let mut index = base_idx + 1;
    while index <= end_idx {
        let wx = period_wx(series, index, elev_m, model, icao);
        if !wx_significant(&sample(&prevailing), &sample(&wx)) {
            index += 1;
            continue;
        }
        if light_wx_churn_only(&prevailing, &wx) {
            let mut run_end = index;
            while run_end < end_idx {
                let next = period_wx(series, run_end + 1, elev_m, model, icao);
                if next.wx != wx.wx || !light_wx_churn_only(&prevailing, &next) {
                    break;
                }
                run_end += 1;
            }
            if run_end - index + 1 < 2 {
                index += 1;
                continue;
            }
            let becmg_end = (index + 2).min(run_end);
            if let Some(window) = change_window(times[index], times[becmg_end], valid_to) {
                let at = period_wx(series, becmg_end, elev_m, model, icao);
                if wx.cld_estimated || at.cld_estimated {
                    cld_estimated = true;
                }
                changes.push(Change {
                    order: times[index].epoch_ms(),
                    text: format!("BECMG {window} {}", group_string(&at, Some(&prevailing.wx))),
                });
                prevailing = at;
                index = becmg_end + 1;
                continue;
            }
            index += 1;
            continue;
        }

        if has_shower_wx(&wx.wx) && !has_shower_wx(&prevailing.wx) {
            let mut run_end = index;
            while run_end < end_idx {
                let next = period_wx(series, run_end + 1, elev_m, model, icao);
                if !has_shower_wx(&next.wx) {
                    break;
                }
                run_end += 1;
            }
            let hours = run_end - index + 1;
            if hours < 3 && run_end < end_idx {
                let mut to_idx = run_end;
                if taf_ddhh(times[index]) == taf_ddhh(times[to_idx]) {
                    to_idx = end_idx.min(run_end + 1);
                }
                if let Some(window) = change_window(times[index], times[to_idx], valid_to) {
                    if wx.cld_estimated {
                        cld_estimated = true;
                    }
                    changes.push(Change {
                        order: times[index].epoch_ms(),
                        text: format!("TEMPO {window} {}", group_string(&wx, None)),
                    });
                }
                index = run_end + 1;
                continue;
            }
        }

        let mut window_end_idx = (index + 2).min(end_idx);
        if window_end_idx <= index {
            index += 1;
            continue;
        }
        let at_end = period_wx(series, window_end_idx, elev_m, model, icao);
        if times[window_end_idx].epoch_ms() > valid_to.epoch_ms() {
            window_end_idx = index.max(end_idx.saturating_sub(1));
            if window_end_idx <= index {
                break;
            }
        }
        let Some(window) = change_window(times[index], times[window_end_idx], valid_to) else {
            index += 1;
            continue;
        };
        let persistent = wx_significant(&sample(&prevailing), &sample(&wx))
            && wx_significant(&sample(&prevailing), &sample(&at_end));
        if persistent {
            if wx.cld_estimated || at_end.cld_estimated {
                cld_estimated = true;
            }
            changes.push(Change {
                order: times[index].epoch_ms(),
                text: format!(
                    "BECMG {window} {}",
                    group_string(&at_end, Some(&prevailing.wx))
                ),
            });
            prevailing = at_end;
            index = window_end_idx + 1;
            continue;
        }

        let mut run_end = index;
        while run_end < end_idx {
            let next = period_wx(series, run_end + 1, elev_m, model, icao);
            if !wx_significant(&sample(&prevailing), &sample(&next)) {
                break;
            }
            run_end += 1;
        }
        let to_idx = end_idx.min(run_end + 1);
        if let Some(tempo) = change_window(times[index], times[to_idx], valid_to) {
            if wx.cld_estimated {
                cld_estimated = true;
            }
            changes.push(Change {
                order: times[index].epoch_ms(),
                text: format!("TEMPO {tempo} {}", group_string(&wx, None)),
            });
        }
        index = if to_idx == index {
            index + 1
        } else {
            run_end + 1
        };
    }

    changes.sort_by_key(|change| change.order);
    let mut pieces = vec![base_group];
    pieces.extend(changes.into_iter().map(|change| change.text));
    pieces.retain(|piece| !piece.is_empty());
    let mut rmk = vec![format!("GEN={run_time}"), format!("MODEL={model}")];
    if vis_estimated {
        rmk.push("VIS EST".to_string());
    }
    if cld_estimated {
        rmk.push("CLD EST".to_string());
    }
    let raw = format!(
        "{STAMP}\n{header} {} RMK {}",
        pieces.join(" "),
        rmk.join(" ")
    );
    Ok(ModelProduct {
        raw,
        vis_estimated,
        cld_estimated,
        mid_cloud_base_unk: false,
    })
}
