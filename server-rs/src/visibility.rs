//! RUC-style surface visibility, and the low-cloud cap used before FG / VV.
//!
//! The RH branch is `60 * exp((-2.5 * (rh - 15)) / 80)`. Precipitation is
//! `min(10, 11.6 * rate^-0.68)`. GFS is the only model whose `visibility`
//! series is treated as observed.

use crate::series::Series;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ResolvedVisibility {
    pub vis_m: Option<f64>,
    pub estimated: bool,
}

pub fn uses_observed_visibility(model: Option<&str>) -> bool {
    model == Some("gfs_seamless")
}

pub fn estimate_visibility_meters(rh_pct: f64, precip_mm_h: f64) -> f64 {
    let rh = 100.0_f64.min(30.0_f64.max(rh_pct));
    let vis_rh_km = 60.0 * ((-2.5 * (rh - 15.0)) / 80.0).exp();
    let mut vis_km = vis_rh_km;
    if precip_mm_h > 0.01 {
        let vis_precip_km = 10.0_f64.min(11.6 * precip_mm_h.powf(-0.68));
        vis_km = vis_km.min(vis_precip_km);
    }
    10_000.0_f64.min(50.0_f64.max(vis_km * 1000.0))
}

fn liquid_precip_mm_h(series: &Series, index: usize) -> f64 {
    if let Some(total) = series.num("precipitation", index) {
        if total > 0.0 {
            return total;
        }
    }
    let rain = series.num("rain", index).unwrap_or(0.0);
    let showers = series.num("showers", index).unwrap_or(0.0);
    let snow = series.num("snowfall", index).unwrap_or(0.0);
    rain + showers + snow * 0.1
}

pub fn cap_estimated_vis_for_low_cloud(
    vis_m: Option<f64>,
    estimated: bool,
    ceiling_ft_agl: Option<f64>,
    obscured: bool,
    spread_c: Option<f64>,
    rh_pct: Option<f64>,
    low_cover_pct: Option<f64>,
) -> Option<f64> {
    if !estimated {
        return vis_m;
    }
    let very_low_base = obscured || ceiling_ft_agl.is_some_and(|ceiling| ceiling <= 100.0);
    let saturated =
        rh_pct.is_some_and(|rh| rh >= 95.0) && spread_c.is_some_and(|spread| spread <= 2.0);
    let saturated_low = saturated
        && (very_low_base
            || ceiling_ft_agl.is_some_and(|ceiling| ceiling <= 500.0)
            || low_cover_pct.is_some_and(|cover| cover >= 62.5));
    if !very_low_base && !saturated_low {
        return vis_m;
    }
    let fog_vis = if obscured || spread_c.is_some_and(|spread| spread <= 0.5) {
        400.0
    } else {
        800.0
    };
    Some(match vis_m {
        Some(vis) => vis.min(fog_vis),
        None => fog_vis,
    })
}

pub fn resolve_visibility_meters(
    series: &Series,
    index: usize,
    model: Option<&str>,
) -> ResolvedVisibility {
    if uses_observed_visibility(model) {
        if let Some(observed) = series.num("visibility", index) {
            return ResolvedVisibility {
                vis_m: Some(observed),
                estimated: false,
            };
        }
    }
    let Some(rh) = series.num("relative_humidity_2m", index) else {
        return ResolvedVisibility {
            vis_m: None,
            estimated: false,
        };
    };
    let precip = liquid_precip_mm_h(series, index);
    ResolvedVisibility {
        vis_m: Some(estimate_visibility_meters(rh, precip)),
        estimated: true,
    }
}
