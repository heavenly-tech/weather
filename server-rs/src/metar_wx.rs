//! METAR/TAF weather and cloud groups, including the #7 ECMWF rules.
//!
//! Broken cover is 62.5% of `max(low, mid)`. Trace rain under 0.2 mm/h with
//! total cloud under 25% is dropped. A mid deck without a convective signal
//! is `-RA` at 700 hPa, or 600 hPa when 700 is missing. The surface LCL is a
//! low-cloud base only when low cloud is at least 10% and the LCL is at least
//! 1500 ft AGL. HZ is dropped when precipitation is present. FG also requires
//! the night, spread, wind, and saturated-level gate in `vis_wx`. VV is written
//! only when the sky is obscured and no FEW/SCT/BKN/OVC group was chosen.

use crate::annex3::kmh_to_kt;
use crate::ceiling::{
    lowest_level_saturated, surface_pressure_hpa, CeilingSample, BKN_CLOUD_COVER_PCT, M_TO_FT,
};
use crate::msa::annex3_nsc_ceiling_ft_agl;
use crate::series::Series;
use crate::vis_wx::{fog_allowed, is_night, vis_obscuration_wx};
use crate::visibility::cap_estimated_vis_for_low_cloud;

const MAX_LCL_SPREAD_C: f64 = 15.0;
pub const TAF_UNKNOWN_LOW_CLOUD_MIN_FT: f64 = 5000.0;
const LEVELS_FOR_NSC: [u16; 10] = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500];

#[derive(Clone, Debug)]
pub struct MetarWx {
    pub clouds: String,
    pub weather: String,
    pub rmk_extra: Vec<String>,
    pub effective_ceil_ft: Option<f64>,
    pub low_cloud_unresolved: bool,
    pub cld_estimated: bool,
    pub mid_cloud_base_unk: bool,
    pub vis_m: Option<f64>,
    pub flight_category: &'static str,
}

pub fn lcl_height_m(temp_c: Option<f64>, dew_c: Option<f64>) -> Option<f64> {
    let spread = temp_c? - dew_c?;
    if spread <= 0.0 {
        Some(0.0)
    } else {
        Some(125.0 * spread)
    }
}

/// Annex 3 hundred-foot cloud group. `floor(ft / 100)`, minimum 1.
pub fn cloud_height_hundreds_ft(ft_agl: f64) -> i64 {
    let floored = (ft_agl / 100.0).floor() as i64;
    floored.max(1)
}

pub fn unknown_low_cloud_cover(for_taf: bool) -> String {
    if for_taf {
        let hundreds = (TAF_UNKNOWN_LOW_CLOUD_MIN_FT / 100.0).floor() as i64;
        format!("BKN{hundreds:03}")
    } else {
        "BKN///".to_string()
    }
}

pub fn has_significant_cloud_below_nsc_ceiling(
    series: &Series,
    index: usize,
    elev_m: f64,
    icao: &str,
) -> bool {
    let threshold_ft = annex3_nsc_ceiling_ft_agl(icao, elev_m);
    let surface_hpa = surface_pressure_hpa(&series.hourly, index, elev_m);
    for hpa in LEVELS_FOR_NSC {
        let height = series.num(&format!("geopotential_height_{hpa}hPa"), index);
        let cover = series.num(&format!("cloud_cover_{hpa}hPa"), index);
        if let (Some(cover), Some(height)) = (cover, height) {
            if cover >= BKN_CLOUD_COVER_PCT
                && height > elev_m
                && f64::from(hpa) <= surface_hpa + 1.0
            {
                let agl_ft = (height - elev_m) * M_TO_FT;
                if agl_ft < threshold_ft {
                    return true;
                }
            }
        }
    }
    false
}

pub fn annex3_nsc_eligible(series: &Series, index: usize, elev_m: f64, icao: &str) -> bool {
    !has_significant_cloud_below_nsc_ceiling(series, index, elev_m, icao)
}

#[allow(clippy::too_many_arguments)]
pub fn derive_metar_wx_and_cloud(
    series: &Series,
    index: usize,
    elev_m: f64,
    icao: &str,
    ceil: &CeilingSample,
    vis_round_m: Option<f64>,
    for_taf: bool,
    vis_estimated: bool,
    model: Option<&str>,
) -> MetarWx {
    let temp = series.num("temperature_2m", index);
    let dew = series.num("dew_point_2m", index);
    let rh = series.num("relative_humidity_2m", index);
    let spread = match (temp, dew) {
        (Some(temp), Some(dew)) => Some(temp - dew),
        _ => None,
    };
    let rain = series.num("rain", index).unwrap_or(0.0);
    let showers = series.num("showers", index).unwrap_or(0.0);
    let snow = series.num("snowfall", index).unwrap_or(0.0);
    let cover_low = series.num("cloud_cover_low", index);

    let liquid_rate = |hour: usize| {
        series
            .num("precipitation", hour)
            .unwrap_or(0.0)
            .max(series.num("rain", hour).unwrap_or(0.0))
            .max(series.num("showers", hour).unwrap_or(0.0))
    };
    let prev_precip = if index > 0 {
        liquid_rate(index - 1)
    } else {
        0.0
    };
    let next_precip = if index + 1 < series.time_len() {
        liquid_rate(index + 1)
    } else {
        0.0
    };
    let hourly_rate = liquid_rate(index);
    let has_adjacent = prev_precip >= 0.1 || next_precip >= 0.1;

    let mut effective_ceil_ft = ceil.ceiling_ft_agl;
    let mut rmk_extra = Vec::new();
    let mut low_unresolved = ceil.low_cloud_unresolved;
    let mut cld_estimated = false;
    let cover_925 = series.num("cloud_cover_925hPa", index);
    let lcl_m = lcl_height_m(temp, dew);
    let lcl_ft = lcl_m.map(|height| height * M_TO_FT);
    let low_cloud_top_ft = series
        .num("geopotential_height_925hPa", index)
        .map(|height| (height - elev_m) * M_TO_FT)
        .map(|feet| feet.max(0.0));
    let lcl_implausible = spread.is_none()
        || spread.is_some_and(|spread| spread > MAX_LCL_SPREAD_C)
        || lcl_ft.is_none()
        || matches!(
            (low_cloud_top_ft, lcl_ft, cover_925),
            (Some(top), Some(lcl), Some(cover)) if top > 0.0 && lcl > top && cover >= BKN_CLOUD_COVER_PCT
        );

    let mut clouds = "NSC".to_string();
    if effective_ceil_ft.is_some_and(|feet| feet > 0.0) {
        let feet = effective_ceil_ft.unwrap_or(0.0);
        let code = if cover_low.is_some_and(|cover| cover >= 87.5) {
            "OVC"
        } else {
            "BKN"
        };
        clouds = format!("{code}{:03}", cloud_height_hundreds_ft(feet));
    } else if !ceil.obscured && cover_low.is_some_and(|cover| cover >= BKN_CLOUD_COVER_PCT) {
        if !lcl_implausible {
            if let Some(lcl_ft) = lcl_ft {
                effective_ceil_ft = Some(lcl_ft);
                low_unresolved = false;
                cld_estimated = true;
                clouds = format!("BKN{:03}", cloud_height_hundreds_ft(lcl_ft));
                rmk_extra.push("CLD EST".to_string());
            }
        } else {
            clouds = unknown_low_cloud_cover(for_taf);
            effective_ceil_ft = if for_taf {
                Some(TAF_UNKNOWN_LOW_CLOUD_MIN_FT)
            } else {
                None
            };
            low_unresolved = true;
            if for_taf {
                cld_estimated = true;
                rmk_extra.push("CLD EST".to_string());
            } else {
                rmk_extra.push("CLD BASE UNK".to_string());
            }
        }
    } else if !ceil.obscured {
        if let Some(layer) = ceil.cape_only_layer {
            clouds = format!(
                "{}{:03}",
                layer.cover,
                cloud_height_hundreds_ft(layer.ft_agl)
            );
            effective_ceil_ft = None;
            low_unresolved = false;
        } else if cover_low.is_some_and(|cover| cover < BKN_CLOUD_COVER_PCT)
            && annex3_nsc_eligible(series, index, elev_m, icao)
        {
            clouds = "NSC".to_string();
        }
    }

    if ceil.obscured && !is_cloud_layer(&clouds) {
        clouds = "VV000".to_string();
        effective_ceil_ft = Some(0.0);
        low_unresolved = false;
    }

    let vis_m = cap_estimated_vis_for_low_cloud(
        vis_round_m,
        vis_estimated,
        effective_ceil_ft,
        ceil.obscured,
        spread,
        rh,
        cover_low,
    );

    let ecmwf = model == Some("ecmwf_ifs025");
    let mut precip_wx = Vec::new();
    let note_cld_est = |cld_estimated: &mut bool, rmk_extra: &mut Vec<String>| {
        *cld_estimated = true;
        if !rmk_extra.iter().any(|item| item == "CLD EST") {
            rmk_extra.push("CLD EST".to_string());
        }
    };
    let level_ft_agl = |hpa: u16| {
        let height = series.num(&format!("geopotential_height_{hpa}hPa"), index)?;
        (height > elev_m).then_some((height - elev_m) * M_TO_FT)
    };
    let mid_cover = series.num("cloud_cover_mid", index);
    let total_cover = series.num("cloud_cover", index);
    let low_pct = cover_low.unwrap_or(0.0);
    let mid_pct = mid_cover.unwrap_or(0.0);
    let total_pct = total_cover.unwrap_or(0.0);
    let low_mid_max = low_pct.max(mid_pct);
    let ecmwf_low_mid_bkn = low_mid_max >= BKN_CLOUD_COVER_PCT;
    let cape = series.num("cape", index).unwrap_or(0.0);
    let conv_base = series.num("convective_cloud_base", index);
    let convective_signal =
        cape >= 100.0 || showers >= 0.1 || conv_base.is_some_and(|base| base > elev_m + 30.0);
    let low_dominant = low_pct >= 50.0 || low_pct >= mid_pct;
    let rain_or_showers = rain.max(showers);
    let ecmwf_liquid = if rain_or_showers > 0.0 {
        rain_or_showers
    } else {
        hourly_rate
    };
    let ecmwf_trace = ecmwf && ecmwf_liquid < 0.2 && total_pct < 25.0;
    let ecmwf_mid_deck =
        ecmwf && !ecmwf_trace && mid_pct >= 50.0 && !convective_signal && !low_dominant;
    let shower_rate = if ecmwf_trace || ecmwf_mid_deck {
        0.0
    } else if ecmwf {
        ecmwf_liquid
    } else {
        showers
    };
    let strat_rain = if ecmwf { 0.0 } else { rain };
    let h700 = level_ft_agl(700).or_else(|| level_ft_agl(600));
    let strat_mid_or_total =
        mid_pct >= 50.0 || total_cover.is_some_and(|_| total_pct >= BKN_CLOUD_COVER_PCT);

    if ecmwf && !ecmwf_trace && ecmwf_liquid >= 0.1 && !is_cloud_layer(&clouds) && !ceil.obscured {
        if (ecmwf_mid_deck || ecmwf_low_mid_bkn) && h700.is_some_and(|feet| feet > 0.0) {
            let feet = h700.unwrap_or(0.0);
            clouds = format!("BKN{:03}", cloud_height_hundreds_ft(feet));
            effective_ceil_ft = Some(feet);
            note_cld_est(&mut cld_estimated, &mut rmk_extra);
        } else if !ecmwf_mid_deck && !ecmwf_low_mid_bkn {
            let lcl_ok = low_pct >= 10.0 && lcl_ft.is_some_and(|feet| feet >= 1500.0);
            let est_ft = if lcl_ok { lcl_ft } else { h700 };
            if let Some(feet) = est_ft.filter(|feet| *feet > 0.0) {
                let cover = cover_for_rate(ecmwf_liquid);
                clouds = format!("{cover}{:03}", cloud_height_hundreds_ft(feet));
                if cover == "BKN" {
                    effective_ceil_ft = Some(feet);
                }
                note_cld_est(&mut cld_estimated, &mut rmk_extra);
            }
        }
    } else if shower_rate >= 0.1 && !is_cloud_layer(&clouds) && !ceil.obscured {
        let from_cb = series
            .num("convective_cloud_base", index)
            .filter(|base| *base > elev_m + 30.0)
            .map(|base| (base - elev_m) * M_TO_FT);
        let from_lcl = if from_cb.is_none()
            && spread.is_some_and(|spread| spread > 0.0 && spread <= MAX_LCL_SPREAD_C)
        {
            lcl_ft
        } else {
            None
        };
        let est_ft = from_cb.or(from_lcl);
        if let Some(feet) = est_ft.filter(|feet| *feet > 0.0) {
            let cover = cover_for_rate(shower_rate);
            clouds = format!("{cover}{:03}", cloud_height_hundreds_ft(feet));
            if cover == "BKN" {
                effective_ceil_ft = Some(feet);
            }
            note_cld_est(&mut cld_estimated, &mut rmk_extra);
        }
    }

    let strat_candidate =
        !ecmwf && shower_rate < 0.1 && hourly_rate >= 0.1 && (has_adjacent || hourly_rate >= 0.25);
    if strat_candidate && !is_cloud_layer(&clouds) && !ceil.obscured {
        let est_ft = if strat_mid_or_total { h700 } else { None };
        if let Some(feet) = est_ft.filter(|feet| *feet > 0.0) {
            clouds = format!("BKN{:03}", cloud_height_hundreds_ft(feet));
            effective_ceil_ft = Some(feet);
            note_cld_est(&mut cld_estimated, &mut rmk_extra);
        }
    }

    let strat_ceil = effective_ceil_ft.is_some_and(|feet| feet <= 3000.0);
    if ceil.obscured && hourly_rate >= 0.1 && !ecmwf_trace {
        let drizzle = spread.is_some_and(|spread| spread <= 3.0) && hourly_rate < 0.5;
        if drizzle {
            let prefix = if hourly_rate < 0.25 { "-" } else { "" };
            precip_wx.push(format!("{prefix}DZ"));
        } else {
            precip_wx.push(rain_token(hourly_rate));
        }
    } else if ecmwf_mid_deck && ecmwf_liquid >= 0.1 && is_cloud_layer(&clouds) {
        precip_wx.push(rain_token(ecmwf_liquid));
    } else if shower_rate >= 0.1 && is_cloud_layer(&clouds) {
        let prefix = if shower_rate < 2.5 {
            "-"
        } else if shower_rate <= 7.6 {
            ""
        } else {
            "+"
        };
        precip_wx.push(format!("{prefix}SHRA"));
    } else if strat_candidate && is_cloud_layer(&clouds) {
        if strat_rain >= 0.1 {
            let prefix = if strat_rain < 2.5 {
                "-"
            } else if strat_rain <= 7.6 {
                ""
            } else {
                "+"
            };
            precip_wx.push(format!("{prefix}RA"));
        } else if strat_ceil && spread.is_some_and(|spread| spread <= 3.0) && hourly_rate < 0.5 {
            let prefix = if hourly_rate < 0.25 {
                "-"
            } else if hourly_rate <= 0.5 {
                ""
            } else {
                "+"
            };
            precip_wx.push(format!("{prefix}DZ"));
        }
    }
    if snow >= 0.1 && temp.is_some_and(|temp| temp <= 2.0) {
        let token = if snow < 2.0 {
            "-SN"
        } else if snow <= 5.0 {
            "SN"
        } else {
            "+SN"
        };
        precip_wx.push(token.to_string());
    }

    let wind_kt = kmh_to_kt(series.num("wind_speed_10m", index));
    let night = series
        .time
        .get(index)
        .is_some_and(|stamp| is_night(icao, stamp));
    let fog_ok = fog_allowed(
        night,
        spread,
        wind_kt,
        lowest_level_saturated(&series.hourly, index, elev_m),
    );
    let vis_wx = vis_obscuration_wx(vis_m, rh, fog_ok);
    let obsc = if !precip_wx.is_empty() && vis_wx == "HZ" {
        ""
    } else {
        vis_wx
    };
    let mut weather_parts = precip_wx;
    if !obsc.is_empty() {
        weather_parts.push(obsc.to_string());
    }
    let weather = weather_parts.join(" ");
    let reported_ceiling_ft =
        if clouds.starts_with("BKN") || clouds.starts_with("OVC") || clouds.starts_with("VV") {
            effective_ceil_ft
        } else {
            None
        };

    MetarWx {
        clouds,
        weather,
        rmk_extra,
        effective_ceil_ft,
        low_cloud_unresolved: low_unresolved,
        cld_estimated,
        mid_cloud_base_unk: false,
        vis_m,
        flight_category: crate::ceiling::flight_category_from_wx(vis_m, reported_ceiling_ft),
    }
}

fn cover_for_rate(rate: f64) -> &'static str {
    if rate >= 2.5 {
        "BKN"
    } else if rate >= 0.5 {
        "SCT"
    } else {
        "FEW"
    }
}

fn rain_token(rate: f64) -> String {
    let prefix = if rate < 2.5 {
        "-"
    } else if rate <= 7.6 {
        ""
    } else {
        "+"
    };
    format!("{prefix}RA")
}

pub fn is_cloud_layer(group: &str) -> bool {
    let rest = group
        .strip_prefix("FEW")
        .or_else(|| group.strip_prefix("SCT"))
        .or_else(|| group.strip_prefix("BKN"))
        .or_else(|| group.strip_prefix("OVC"));
    match rest {
        Some("///") => true,
        Some(digits) => digits.len() == 3 && digits.bytes().all(|byte| byte.is_ascii_digit()),
        None => false,
    }
}
