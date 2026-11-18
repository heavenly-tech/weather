//! Annex 3 change bins for TAF grouping, and the TAF visibility steps.
//!
//! TAF visibility floors. METAR visibility rounds, in `metar`. Direction and
//! speed thresholds match `wmo-annex3.ts`.

use crate::round::js_round;

const VIS_THRESHOLDS_M: [f64; 7] = [150.0, 350.0, 600.0, 800.0, 1500.0, 3000.0, 5000.0];
const CEIL_THRESHOLDS_FT: [f64; 6] = [100.0, 200.0, 500.0, 1000.0, 1500.0, 3000.0];

pub fn round_vis_taf_meters(m: f64) -> f64 {
    if m >= 9990.0 {
        return 9999.0;
    }
    if m < 800.0 {
        return (m / 50.0).floor() * 50.0;
    }
    if m < 5000.0 {
        return (m / 100.0).floor() * 100.0;
    }
    9999.0_f64.min((m / 1000.0).floor() * 1000.0)
}

pub fn round_vis_taf(m: f64) -> String {
    format!("{:04}", round_vis_taf_meters(m) as i64)
}

pub fn vis_category(m: Option<f64>) -> usize {
    let Some(m) = m else {
        return VIS_THRESHOLDS_M.len();
    };
    VIS_THRESHOLDS_M
        .iter()
        .position(|threshold| m < *threshold)
        .unwrap_or(VIS_THRESHOLDS_M.len())
}

pub fn ceil_category(ft: Option<f64>) -> usize {
    let Some(ft) = ft else {
        return CEIL_THRESHOLDS_FT.len();
    };
    CEIL_THRESHOLDS_FT
        .iter()
        .position(|threshold| ft < *threshold)
        .unwrap_or(CEIL_THRESHOLDS_FT.len())
}

fn js_rem(n: f64, m: f64) -> f64 {
    n - (n / m).trunc() * m
}

pub fn wind_dir_delta(a: f64, b: f64) -> f64 {
    (js_rem(b - a + 540.0, 360.0) - 180.0).abs()
}

pub fn wind_significant(
    dir_a: Option<f64>,
    kt_a: Option<f64>,
    dir_b: Option<f64>,
    kt_b: Option<f64>,
) -> bool {
    let (Some(kt_a), Some(kt_b)) = (kt_a, kt_b) else {
        return false;
    };
    if (kt_a - kt_b).abs() >= 10.0 {
        return true;
    }
    if let (Some(dir_a), Some(dir_b)) = (dir_a, dir_b) {
        if kt_a >= 10.0 && kt_b >= 10.0 && wind_dir_delta(dir_a, dir_b) >= 60.0 {
            return true;
        }
    }
    false
}

pub fn vis_significant(a_m: Option<f64>, b_m: Option<f64>) -> bool {
    vis_category(a_m) != vis_category(b_m)
}

pub fn ceil_significant(a_ft: Option<f64>, b_ft: Option<f64>) -> bool {
    ceil_category(a_ft) != ceil_category(b_ft)
}

pub struct WxSample {
    pub dir: Option<f64>,
    pub kt: Option<f64>,
    pub vis_m: Option<f64>,
    pub ceil_ft: Option<f64>,
    pub wx: String,
}

pub fn wx_significant(a: &WxSample, b: &WxSample) -> bool {
    wind_significant(a.dir, a.kt, b.dir, b.kt)
        || vis_significant(a.vis_m, b.vis_m)
        || ceil_significant(a.ceil_ft, b.ceil_ft)
        || a.wx != b.wx
}

/// Knots from km/h. `Math.round(kmh / 1.852)`, via [`js_round`].
pub fn kmh_to_kt(kmh: Option<f64>) -> Option<f64> {
    let kmh = kmh.filter(|value| value.is_finite())?;
    Some(js_round(kmh / 1.852))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::round::js_round;

    #[test]
    fn negative_half_speed_uses_js_round_not_away_from_zero() {
        let kmh = -1.5 * 1.852;
        assert_eq!(js_round(kmh / 1.852), -1.0);
        assert_eq!((kmh / 1.852).round(), -2.0);
        assert_eq!(kmh_to_kt(Some(kmh)), Some(-1.0));
    }
}
