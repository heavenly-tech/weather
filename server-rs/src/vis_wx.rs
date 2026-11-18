//! Present weather from visibility, humidity, and the fog gate.
//!
//! FG is emitted only when the coded visibility is below 1000 m and every
//! fog condition holds: night, temperature minus dew point at most 1 °C,
//! wind at most 5 kt, and a saturated lowest level. Mist (BR) is the
//! 3000–5000 m band when relative humidity is at least 80%. A failed fog
//! test below 3000 m emits no obscuration group. Dry air from 1000 m through
//! 5000 m stays HZ. Nothing is emitted above 5000 m.
//!
//! Night is a solar elevation below 0° at the aerodrome (sun below the
//! horizon). The elevation is the NOAA solar-position approximation. The
//! lowest level is the lowest pressure level above the field; it is
//! saturated at a relative humidity of at least 95%, the same threshold the
//! low-cloud visibility cap already uses. With no pressure level above the
//! field, the surface relative humidity is that lowest level.

use crate::stations;
use crate::utc::{parse_utc_iso, UtcStamp};

const SATURATED_RH: f64 = 95.0;

pub fn fog_allowed(
    night: bool,
    spread_c: Option<f64>,
    wind_kt: Option<f64>,
    lowest_saturated: bool,
) -> bool {
    night
        && spread_c.is_some_and(|spread| spread <= 1.0)
        && wind_kt.is_some_and(|kt| kt <= 5.0)
        && lowest_saturated
}

/// PROB30 BR/FG. Night, a spread of at most 2 °C, and wind of at most 5 kt.
/// The saturated-level test and the 1 °C FG gate are not required.
pub fn fog_risk(night: bool, spread_c: Option<f64>, wind_kt: Option<f64>) -> bool {
    night && spread_c.is_some_and(|spread| spread <= 2.0) && wind_kt.is_some_and(|kt| kt <= 5.0)
}

pub fn is_night(icao: &str, iso: &str) -> bool {
    let Ok(stamp) = parse_utc_iso(iso) else {
        return false;
    };
    let station = stations::require_station(icao);
    solar_elevation_deg(station.lat, station.lon, stamp) < 0.0
}

pub fn vis_obscuration_wx(vis_m: Option<f64>, rh_pct: Option<f64>, fog_ok: bool) -> &'static str {
    let Some(vis_m) = vis_m else {
        return "";
    };
    if vis_m > 5000.0 {
        return "";
    }
    if vis_m < 1000.0 {
        return if fog_ok { "FG" } else { "" };
    }
    if (3000.0..=5000.0).contains(&vis_m) && rh_pct.is_some_and(|rh| rh >= 80.0) {
        return "BR";
    }
    if rh_pct.is_none_or(|rh| rh < 80.0) {
        "HZ"
    } else {
        ""
    }
}

pub fn saturated_rh(rh_pct: Option<f64>) -> bool {
    rh_pct.is_some_and(|rh| rh >= SATURATED_RH)
}

/// Solar elevation in degrees. Positive is day.
fn solar_elevation_deg(lat_deg: f64, lon_deg: f64, stamp: UtcStamp) -> f64 {
    let jd = stamp.epoch_ms() as f64 / 86_400_000.0 + 2_440_587.5;
    let t = (jd - 2_451_545.0) / 36_525.0;
    let rad = std::f64::consts::PI / 180.0;
    let deg = 180.0 / std::f64::consts::PI;
    let l0 = (280.46646 + t * (36_000.769_83 + t * 0.0003032)).rem_euclid(360.0);
    let mean = (357.52911 + t * (35_999.050_29 - 0.0001537 * t)).rem_euclid(360.0);
    let mean_rad = mean * rad;
    let eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    let center = mean_rad.sin() * (1.914602 - t * (0.004817 + 0.000014 * t))
        + (2.0 * mean_rad).sin() * (0.019993 - 0.000101 * t)
        + (3.0 * mean_rad).sin() * 0.000289;
    let true_long = l0 + center;
    let omega = 125.04 - 1934.136 * t;
    let lambda = true_long - 0.00569 - 0.00478 * (omega * rad).sin();
    let seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
    let epsilon0 = 23.0 + (26.0 + seconds / 60.0) / 60.0;
    let epsilon = epsilon0 + 0.00256 * (omega * rad).cos();
    let decl = ((epsilon * rad).sin() * (lambda * rad).sin()).asin();
    let y = ((epsilon * rad) / 2.0).tan().powi(2);
    let eqtime = 4.0
        * deg
        * (y * (2.0 * l0 * rad).sin() - 2.0 * eccentricity * mean_rad.sin()
            + 4.0 * eccentricity * y * mean_rad.sin() * (2.0 * l0 * rad).cos()
            - 0.5 * y * y * (4.0 * l0 * rad).sin()
            - 1.25 * eccentricity * eccentricity * (2.0 * mean_rad).sin());
    let parts = stamp.parts();
    let minutes = parts.hour as f64 * 60.0 + parts.minute as f64 + parts.second as f64 / 60.0;
    let solar_minutes = (minutes + eqtime + 4.0 * lon_deg).rem_euclid(1440.0);
    let hour_angle = solar_minutes / 4.0 - 180.0;
    let lat = lat_deg * rad;
    let cos_zenith = lat.sin() * decl.sin() + lat.cos() * decl.cos() * (hour_angle * rad).cos();
    90.0 - cos_zenith.clamp(-1.0, 1.0).acos() * deg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sctb_twilight_brackets_sunset() {
        // Sunset on 2026-11-17 at SCTB is the minute solar elevation crosses
        // below 0: 23:20Z is still day, 23:21Z is night.
        assert!(!is_night("SCTB", "2026-11-17T23:20:00Z"));
        assert!(is_night("SCTB", "2026-11-17T23:21:00Z"));
    }

    #[test]
    fn santiago_november_night_and_day() {
        assert!(is_night("SCTB", "2026-11-17T05:00"));
        assert!(is_night("SCEL", "2026-11-17T05:00:00Z"));
        assert!(!is_night("SCTB", "2026-11-17T16:00"));
        assert!(!is_night("SCTB", "not-a-time"));
    }

    #[test]
    fn fog_requires_every_condition() {
        assert!(fog_allowed(true, Some(1.0), Some(5.0), true));
        assert!(!fog_allowed(false, Some(0.0), Some(0.0), true));
        assert!(!fog_allowed(true, Some(1.1), Some(0.0), true));
        assert!(!fog_allowed(true, Some(0.0), Some(5.1), true));
        assert!(!fog_allowed(true, Some(0.0), Some(0.0), false));
        assert!(!fog_allowed(true, None, Some(0.0), true));
        assert!(!fog_allowed(true, Some(0.0), None, true));
    }

    #[test]
    fn fog_risk_is_the_wider_night_gate() {
        assert!(fog_risk(true, Some(2.0), Some(5.0)));
        assert!(fog_risk(true, Some(1.5), Some(0.0)));
        assert!(!fog_risk(false, Some(0.0), Some(0.0)));
        assert!(!fog_risk(true, Some(2.1), Some(0.0)));
        assert!(!fog_risk(true, Some(0.0), Some(5.1)));
        assert!(!fog_risk(true, None, Some(0.0)));
        assert!(!fog_risk(true, Some(0.0), None));
    }
}
