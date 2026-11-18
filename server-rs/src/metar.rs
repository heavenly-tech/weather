//! Generated METAR body.
//!
//! Group order is ICAO, `DDHHMMZ`, wind, visibility, weather, clouds,
//! temperature/dewpoint, QNH, then `RMK`. Visibility uses `Math.round`.
//! Temperature uses the signed half-up rule in WMO-No. 306 Regulation 15.11
//! and FAA FMH-1 §§2.6.3 and 12.6.10: `-1.5` is `M01` and `-0.5` is `M00`.

use crate::annex3::kmh_to_kt;
use crate::ceiling::ceiling_from_hourly;
use crate::metar_wx::derive_metar_wx_and_cloud;
use crate::round::js_round;
use crate::series::Series;
use crate::utc::parse_utc_iso;
use crate::visibility::resolve_visibility_meters;

pub const STAMP: &str = "MODEL OUTPUT \u{2014} NOT OFFICIAL";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelProduct {
    pub raw: String,
    pub vis_estimated: bool,
    pub cld_estimated: bool,
    pub mid_cloud_base_unk: bool,
}

pub fn metar_ddhhmmz(iso: &str) -> Result<String, String> {
    let stamp = parse_utc_iso(iso)?;
    let parts = stamp.parts();
    Ok(format!(
        "{:02}{:02}{:02}Z",
        parts.day, parts.hour, parts.minute
    ))
}

fn round_vis_m(m: f64) -> f64 {
    if m >= 9990.0 {
        return 9999.0;
    }
    if m < 800.0 {
        return js_round(m / 50.0) * 50.0;
    }
    if m < 5000.0 {
        return js_round(m / 100.0) * 100.0;
    }
    9999.0_f64.min(js_round(m / 1000.0) * 1000.0)
}

pub fn format_model_wind(
    dir: Option<f64>,
    speed_kmh: Option<f64>,
    gust_kmh: Option<f64>,
) -> String {
    let Some(kt) = kmh_to_kt(speed_kmh) else {
        return "/////KT".to_string();
    };
    if kt < 1.0 {
        return "00000KT".to_string();
    }
    let gust_kt = kmh_to_kt(gust_kmh);
    let gust_suffix = match gust_kt {
        Some(gust) if gust >= kt + 10.0 => format!("G{:02}", js_round(gust) as i64),
        _ => String::new(),
    };
    let has_gust = !gust_suffix.is_empty();
    if kt < 3.0 || dir.is_none() {
        let base = format!("VRB{:02}", js_round(kt) as i64);
        return if has_gust {
            format!("{base}{gust_suffix}KT")
        } else {
            format!("{base}KT")
        };
    }
    let mut degrees = js_round(dir.unwrap_or(0.0) / 10.0) * 10.0;
    if degrees == 0.0 {
        degrees = 360.0;
    }
    let ddd = format!("{:03}", degrees as i64);
    let ff = format!("{:02}", js_round(kt) as i64);
    if has_gust {
        format!("{ddd}{ff}{gust_suffix}KT")
    } else {
        format!("{ddd}{ff}KT")
    }
}

fn format_temp_token(n: f64) -> String {
    // Half degrees round toward the warmer whole degree (`js_round`), then a
    // negative observation keeps the M prefix even when that whole degree is 0.
    let rounded = js_round(n);
    let digits = format!("{:02}", rounded.abs() as i64);
    if n < 0.0 {
        format!("M{digits}")
    } else {
        digits
    }
}

fn format_temp_group(temp_c: Option<f64>, dew_c: Option<f64>) -> String {
    match (temp_c, dew_c) {
        (Some(temp), Some(dew)) => {
            format!("{}/{}", format_temp_token(temp), format_temp_token(dew))
        }
        _ => "/////".to_string(),
    }
}

fn format_qnh(hpa: Option<f64>) -> String {
    let Some(hpa) = hpa else {
        return String::new();
    };
    format!("Q{:04}", hpa.floor() as i64)
}

fn format_vis_group(vis_m: Option<f64>) -> String {
    match vis_m {
        Some(vis) => format!("{:04}", vis as i64),
        None => "////".to_string(),
    }
}

pub fn generate_model_metar(
    icao: &str,
    elev_m: f64,
    model: &str,
    run_time: &str,
    valid_time: &str,
    series: &Series,
    hour_index: usize,
) -> Result<ModelProduct, String> {
    let resolved = resolve_visibility_meters(series, hour_index, Some(model));
    let vis_rounded = resolved.vis_m.map(round_vis_m);
    let ceil = ceiling_from_hourly(&series.hourly, hour_index, elev_m);
    let derived = derive_metar_wx_and_cloud(
        series,
        hour_index,
        elev_m,
        icao,
        &ceil,
        vis_rounded,
        false,
        resolved.estimated,
        Some(model),
    );
    let stamp = metar_ddhhmmz(valid_time)?;
    let wind = format_model_wind(
        series.num("wind_direction_10m", hour_index),
        series.num("wind_speed_10m", hour_index),
        series.num("wind_gusts_10m", hour_index),
    );
    let mut parts = vec![
        icao.to_string(),
        stamp,
        wind,
        format_vis_group(derived.vis_m),
    ];
    if !derived.weather.is_empty() {
        parts.push(derived.weather);
    }
    if !derived.clouds.is_empty() {
        parts.push(derived.clouds);
    }
    let temp = format_temp_group(
        series.num("temperature_2m", hour_index),
        series.num("dew_point_2m", hour_index),
    );
    if !temp.is_empty() {
        parts.push(temp);
    }
    let qnh = format_qnh(series.num("pressure_msl", hour_index));
    if !qnh.is_empty() {
        parts.push(qnh);
    }
    let mut rmk = vec![format!("GEN={run_time}"), format!("MODEL={model}")];
    rmk.extend(derived.rmk_extra);
    if resolved.estimated {
        rmk.push("VIS EST".to_string());
    }
    let raw = format!("{STAMP}\nMETAR {} RMK {}", parts.join(" "), rmk.join(" "));
    Ok(ModelProduct {
        raw,
        vis_estimated: resolved.estimated,
        cld_estimated: derived.cld_estimated,
        mid_cloud_base_unk: derived.mid_cloud_base_unk,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn negative_halves_round_toward_the_warmer_degree() {
        assert_eq!(format_temp_token(-1.5), "M01");
        assert_eq!(format_temp_token(-0.5), "M00");
        assert_eq!(format_temp_token(-0.4), "M00");
        assert_eq!(format_temp_token(-1.6), "M02");
        assert_eq!(format_temp_token(0.5), "01");
        assert_eq!(format_temp_token(1.5), "02");
        assert_eq!(format_temp_token(-0.0), "00");
    }
}
