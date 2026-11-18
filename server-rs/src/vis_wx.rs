//! Present weather from visibility and relative humidity.
//!
//! FG below 1000 m. From 1000 m through 5000 m inclusive: BR when RH is at
//! least 80%, otherwise HZ. No obscuration group above 5000 m.

pub fn vis_obscuration_wx(vis_m: Option<f64>, rh_pct: Option<f64>) -> &'static str {
    let Some(vis_m) = vis_m else {
        return "";
    };
    if vis_m > 5000.0 {
        return "";
    }
    if vis_m < 1000.0 {
        return "FG";
    }
    if rh_pct.is_some_and(|rh| rh >= 80.0) {
        "BR"
    } else {
        "HZ"
    }
}
