//! Port of `src/lib/andes/ceiling.ts`.
//!
//! Stratiform base is a linear cover crossing at 62.5%. The fine-grid regrid
//! does not live here. Feet use the literal `3.280839895`, and a missing
//! sample stays `None` instead of becoming `0.0`.

use crate::js_json::{js_opt_num, Js};
use crate::round::js_round;
use serde_json::Value;
use std::collections::BTreeMap;

pub const BKN_CLOUD_COVER_PCT: f64 = 62.5;
pub const LOW_CLOUD_GATE_PCT: f64 = 50.0;
/// `(baseMslM - elevM) * 3.280839895`. Not `1 / 0.3048`.
pub const M_TO_FT: f64 = 3.280839895;

const P0: f64 = 1013.25;
const OBSCURATION_EPS_M: f64 = 5.0;
const LEVELS_DESC: [u16; 12] = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300];

const SM_TO_M: f64 = 1609.344;
const VFR_VIS_M: f64 = 5.0 * SM_TO_M;
const MVFR_VIS_M: f64 = 3.0 * SM_TO_M;
const IFR_VIS_M: f64 = 1.0 * SM_TO_M;

#[derive(Clone, Debug, Default)]
pub struct Hourly {
    series: BTreeMap<String, Vec<Option<f64>>>,
}

impl Hourly {
    pub fn from_json(value: &Value) -> Self {
        let mut series = BTreeMap::new();
        let Some(obj) = value.as_object() else {
            return Self { series };
        };
        for (key, item) in obj {
            let Some(values) = item.as_array() else {
                continue;
            };
            series.insert(key.clone(), values.iter().map(parse_json_number).collect());
        }
        Self { series }
    }
}

/// JSON number, or the strings `NaN` / `Infinity` / `-Infinity`.
/// Anything else (null, time strings) is missing.
pub fn parse_json_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => match text.as_str() {
            "NaN" => Some(f64::NAN),
            "Infinity" => Some(f64::INFINITY),
            "-Infinity" => Some(f64::NEG_INFINITY),
            _ => None,
        },
        _ => None,
    }
}

/// Missing key, null, non-number, NaN, and infinities are all `None`.
/// A numeric `0` stays `Some(0)`.
pub fn num_at(hourly: &Hourly, key: &str, index: usize) -> Option<f64> {
    let value = hourly.series.get(key)?.get(index).copied().flatten()?;
    value.is_finite().then_some(value)
}

pub fn surface_pressure_hpa(hourly: &Hourly, index: usize, terrain_elev_m: f64) -> f64 {
    if let Some(surface) = num_at(hourly, "surface_pressure", index) {
        if surface > 400.0 && surface < 1100.0 {
            return surface;
        }
    }
    P0 * (1.0 - terrain_elev_m / 44330.0).powf(5.255)
}

pub fn pressure_level_above_terrain(
    level_hpa: f64,
    geopotential_height_m: Option<f64>,
    terrain_elev_m: f64,
    surface_hpa: f64,
) -> bool {
    if level_hpa > surface_hpa {
        return false;
    }
    let Some(height) = geopotential_height_m else {
        return false;
    };
    height > terrain_elev_m
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CeilingMethod {
    CloudBaseField,
    Interpolated,
    Unlimited,
    Fog,
}

impl CeilingMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CloudBaseField => "cloud_base_field",
            Self::Interpolated => "interpolated",
            Self::Unlimited => "unlimited",
            Self::Fog => "fog",
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct LevelSample {
    hpa: f64,
    height_m: f64,
    cover: Option<f64>,
    rh: Option<f64>,
}

fn collect_levels_above_ground(
    hourly: &Hourly,
    index: usize,
    terrain_elev_m: f64,
    surface_hpa: f64,
) -> Vec<LevelSample> {
    let mut out = Vec::new();
    for hpa in LEVELS_DESC {
        if f64::from(hpa) > surface_hpa {
            continue;
        }
        let height = num_at(hourly, &format!("geopotential_height_{hpa}hPa"), index);
        if !pressure_level_above_terrain(f64::from(hpa), height, terrain_elev_m, surface_hpa) {
            continue;
        }
        let Some(height_m) = height else {
            continue;
        };
        out.push(LevelSample {
            hpa: f64::from(hpa),
            height_m,
            cover: num_at(hourly, &format!("cloud_cover_{hpa}hPa"), index),
            rh: num_at(hourly, &format!("relative_humidity_{hpa}hPa"), index),
        });
    }
    out.sort_by(|left, right| {
        left.height_m
            .partial_cmp(&right.height_m)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// The lowest model level above the aerodrome is saturated at RH ≥ 95.
/// With no such level, the surface humidity is the lowest level we have.
pub fn lowest_level_saturated(hourly: &Hourly, index: usize, terrain_elev_m: f64) -> bool {
    let surface_hpa = surface_pressure_hpa(hourly, index, terrain_elev_m);
    let levels = collect_levels_above_ground(hourly, index, terrain_elev_m, surface_hpa);
    if let Some(lowest) = levels.first() {
        return lowest.rh.is_some_and(|rh| rh >= 95.0);
    }
    num_at(hourly, "relative_humidity_2m", index).is_some_and(|rh| rh >= 95.0)
}

fn cover_or_rh(sample: &LevelSample, rh_fill: f64) -> f64 {
    if let Some(cover) = sample.cover {
        cover
    } else if sample.rh.is_some_and(|rh| rh >= 87.0) {
        rh_fill
    } else {
        0.0
    }
}

/// `Math.max`, which returns NaN when either side is NaN.
fn js_max(left: f64, right: f64) -> f64 {
    if left.is_nan() || right.is_nan() {
        f64::NAN
    } else if left > right {
        left
    } else {
        right
    }
}

#[derive(Clone, Copy, Debug)]
pub struct InterpolatedBase {
    pub base_msl_m: Option<f64>,
    pub method: CeilingMethod,
    pub low_cloud_unresolved: bool,
}

impl InterpolatedBase {
    pub fn to_json_bytes(&self) -> Vec<u8> {
        Js::Obj(vec![
            ("baseMslM", js_opt_num(self.base_msl_m)),
            ("method", Js::Str(self.method.as_str())),
            ("lowCloudUnresolved", Js::Bool(self.low_cloud_unresolved)),
        ])
        .to_bytes()
    }
}

pub fn interpolate_cloud_base_msl(
    hourly: &Hourly,
    index: usize,
    terrain_elev_m: f64,
    surface_hpa: f64,
) -> InterpolatedBase {
    let levels = collect_levels_above_ground(hourly, index, terrain_elev_m, surface_hpa);
    let low_cover = num_at(hourly, "cloud_cover_low", index);
    let floor = LevelSample {
        // Math.round(surfaceHpa). Halves go toward +∞.
        hpa: js_round(surface_hpa),
        height_m: terrain_elev_m,
        cover: Some(0.0),
        rh: num_at(hourly, "relative_humidity_2m", index),
    };
    let mut chain = Vec::with_capacity(levels.len() + 1);
    chain.push(floor);
    chain.extend(levels);

    for index in 1..chain.len() {
        let below = chain[index - 1];
        let above = chain[index];
        let c0 = cover_or_rh(&below, BKN_CLOUD_COVER_PCT - 1.0);
        let c1 = cover_or_rh(&above, BKN_CLOUD_COVER_PCT);
        // The empty branch in ceiling.ts is the RH-only assist: a missing
        // cover with RH ≥ 87 falls through into the crossing test instead of
        // being skipped with the "cover still below BKN" continue.
        let rh_only_assist = above.cover.is_none()
            && above.rh.is_some_and(|rh| rh >= 87.0)
            && below.cover.is_some_and(|cover| cover < BKN_CLOUD_COVER_PCT);
        let cover_still_below = above.cover.is_some_and(|cover| cover < BKN_CLOUD_COVER_PCT);
        if !rh_only_assist && cover_still_below {
            continue;
        }
        if c1 >= BKN_CLOUD_COVER_PCT {
            if c0 >= BKN_CLOUD_COVER_PCT && below.hpa < 1000.0 {
                return InterpolatedBase {
                    base_msl_m: Some(below.height_m),
                    method: CeilingMethod::Interpolated,
                    low_cloud_unresolved: false,
                };
            }
            if c1 == c0 {
                return InterpolatedBase {
                    base_msl_m: Some(above.height_m),
                    method: CeilingMethod::Interpolated,
                    low_cloud_unresolved: false,
                };
            }
            let frac = (BKN_CLOUD_COVER_PCT - c0) / (c1 - c0);
            let height = below.height_m + frac * (above.height_m - below.height_m);
            return InterpolatedBase {
                base_msl_m: Some(js_max(terrain_elev_m, height)),
                method: CeilingMethod::Interpolated,
                low_cloud_unresolved: false,
            };
        }
    }

    InterpolatedBase {
        base_msl_m: None,
        method: CeilingMethod::Unlimited,
        low_cloud_unresolved: low_cover.is_some_and(|cover| cover >= LOW_CLOUD_GATE_PCT),
    }
}

#[derive(Clone, Copy, Debug)]
enum IconConvective {
    Ceiling { msl_m: f64 },
    Layer { ft_agl: f64, cover: &'static str },
}

fn icon_convective(hourly: &Hourly, index: usize, terrain_elev_m: f64) -> Option<IconConvective> {
    let cb = num_at(hourly, "convective_cloud_base", index)?;
    if cb <= 0.0 {
        return None;
    }
    let showers = num_at(hourly, "showers", index).unwrap_or(0.0);
    let rain = num_at(hourly, "rain", index).unwrap_or(0.0);
    let precip = num_at(hourly, "precipitation", index).unwrap_or(0.0);
    let low = num_at(hourly, "cloud_cover_low", index).unwrap_or(0.0);
    let cape = num_at(hourly, "cape", index);
    let backed_by_precip = showers >= 0.1 || rain >= 0.1 || precip >= 0.1;
    let backed_by_cover = low >= BKN_CLOUD_COVER_PCT;
    if backed_by_precip || backed_by_cover {
        return Some(IconConvective::Ceiling { msl_m: cb });
    }
    let cape = cape?;
    if cape < 100.0 {
        return None;
    }
    let agl_m = cb - terrain_elev_m;
    if agl_m <= 30.0 {
        return None;
    }
    let cover = if cape >= 800.0 || low >= 37.5 {
        "SCT"
    } else {
        "FEW"
    };
    Some(IconConvective::Layer {
        ft_agl: agl_m * M_TO_FT,
        cover,
    })
}

fn fog_base_msl(
    hourly: &Hourly,
    index: usize,
    terrain_elev_m: f64,
    surface_hpa: f64,
    vis_m: Option<f64>,
) -> Option<f64> {
    let rh2 = num_at(hourly, "relative_humidity_2m", index);
    let levels = collect_levels_above_ground(hourly, index, terrain_elev_m, surface_hpa);
    let lowest = levels.first();
    let fog_vis = vis_m.is_some_and(|vis| vis < 1000.0);
    let moist_surface = rh2.is_some_and(|rh| rh >= 97.0)
        && lowest.is_some_and(|level| {
            level.cover.unwrap_or(0.0) >= BKN_CLOUD_COVER_PCT
                && level.height_m - terrain_elev_m <= 80.0
        });
    if fog_vis || moist_surface {
        Some(terrain_elev_m)
    } else {
        None
    }
}

/// FAA/AWC flight category. Null visibility or ceiling is treated as unlimited.
pub fn flight_category_from_wx(vis_m: Option<f64>, ceiling_ft: Option<f64>) -> &'static str {
    let vis = vis_m.unwrap_or(f64::INFINITY);
    let ceil = ceiling_ft.unwrap_or(f64::INFINITY);
    if ceil < 500.0 || vis < IFR_VIS_M {
        "LIFR"
    } else if ceil < 1000.0 || vis < MVFR_VIS_M {
        "IFR"
    } else if ceil <= 3000.0 || vis <= VFR_VIS_M {
        "MVFR"
    } else {
        "VFR"
    }
}

pub fn ceiling_category_from_ft_agl(
    ceiling_ft_agl: Option<f64>,
    vis_m: Option<f64>,
) -> &'static str {
    flight_category_from_wx(vis_m, ceiling_ft_agl)
}

pub fn category_color(category: &str) -> &'static str {
    match category {
        "VFR" => "#22c55e",
        "MVFR" => "#38bdf8",
        "IFR" => "#fbbf24",
        "LIFR" => "#f87171",
        _ => "#94a3b8",
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CapeOnlyLayer {
    pub ft_agl: f64,
    pub cover: &'static str,
}

#[derive(Clone, Copy, Debug)]
pub struct CeilingSample {
    pub ceiling_ft_agl: Option<f64>,
    pub ceiling_category: &'static str,
    pub cloud_base_msl_m: Option<f64>,
    pub obscured: bool,
    pub low_cloud_unresolved: bool,
    pub method: CeilingMethod,
    pub vis_m: Option<f64>,
    pub cape_only_layer: Option<CapeOnlyLayer>,
}

impl CeilingSample {
    pub fn to_json_bytes(&self) -> Vec<u8> {
        let cape = match self.cape_only_layer {
            Some(layer) => Js::Obj(vec![
                ("ftAgl", Js::Num(layer.ft_agl)),
                ("cover", Js::Str(layer.cover)),
            ]),
            None => Js::Null,
        };
        Js::Obj(vec![
            ("ceilingFtAgl", js_opt_num(self.ceiling_ft_agl)),
            ("ceilingCategory", Js::Str(self.ceiling_category)),
            ("cloudBaseMslM", js_opt_num(self.cloud_base_msl_m)),
            ("obscured", Js::Bool(self.obscured)),
            ("lowCloudUnresolved", Js::Bool(self.low_cloud_unresolved)),
            ("method", Js::Str(self.method.as_str())),
            ("visM", js_opt_num(self.vis_m)),
            ("capeOnlyLayer", cape),
        ])
        .to_bytes()
    }
}

pub fn ceiling_from_hourly(hourly: &Hourly, index: usize, terrain_elev_m: f64) -> CeilingSample {
    let surface_hpa = surface_pressure_hpa(hourly, index, terrain_elev_m);
    let vis_m = num_at(hourly, "visibility", index);
    let strat = interpolate_cloud_base_msl(hourly, index, terrain_elev_m, surface_hpa);
    let conv = icon_convective(hourly, index, terrain_elev_m);
    let fog_msl = fog_base_msl(hourly, index, terrain_elev_m, surface_hpa, vis_m);

    let mut cloud_base_msl_m = strat.base_msl_m;
    let mut method = strat.method;
    let mut cape_only_layer = None;

    if let Some(fog) = fog_msl {
        if cloud_base_msl_m.is_none_or(|base| fog < base) {
            cloud_base_msl_m = Some(fog);
            method = CeilingMethod::Fog;
        }
    }

    match conv {
        Some(IconConvective::Ceiling { msl_m }) => {
            if cloud_base_msl_m.is_none_or(|base| msl_m < base) {
                cloud_base_msl_m = Some(msl_m);
                method = CeilingMethod::CloudBaseField;
            }
        }
        Some(IconConvective::Layer { ft_agl, cover }) => {
            cape_only_layer = Some(CapeOnlyLayer { ft_agl, cover });
        }
        None => {}
    }

    let Some(cloud_base_msl_m) = cloud_base_msl_m else {
        return CeilingSample {
            ceiling_ft_agl: None,
            ceiling_category: flight_category_from_wx(vis_m, None),
            cloud_base_msl_m: None,
            obscured: false,
            low_cloud_unresolved: strat.low_cloud_unresolved,
            method: CeilingMethod::Unlimited,
            vis_m,
            cape_only_layer,
        };
    };

    let obscured = cloud_base_msl_m <= terrain_elev_m + OBSCURATION_EPS_M;
    let agl_m = cloud_base_msl_m - terrain_elev_m;
    let ceiling_ft_agl = (agl_m > 0.0).then_some(agl_m * M_TO_FT);
    CeilingSample {
        ceiling_ft_agl,
        ceiling_category: flight_category_from_wx(vis_m, ceiling_ft_agl),
        cloud_base_msl_m: Some(cloud_base_msl_m),
        obscured,
        low_cloud_unresolved: false,
        method,
        vis_m,
        cape_only_layer: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(id: &str) -> Value {
        crate::parity_eval::load_example(id)
    }

    fn hourly_from(id: &str) -> (Value, Hourly) {
        let value = input(id);
        let hourly = Hourly::from_json(&value["hourly"]);
        (value, hourly)
    }

    fn f64_field(value: &Value, key: &str) -> f64 {
        value[key]
            .as_f64()
            .unwrap_or_else(|| panic!("{key} number"))
    }

    fn index_of(value: &Value) -> usize {
        value["index"].as_u64().expect("index") as usize
    }

    #[test]
    fn feet_factor_is_the_literal_not_the_reciprocal() {
        assert_eq!(M_TO_FT.to_bits(), 3.280839895_f64.to_bits());
        assert_ne!(M_TO_FT.to_bits(), (1.0_f64 / 0.3048).to_bits());
    }

    #[test]
    fn missing_null_and_non_finite_stay_null_and_zero_stays_zero() {
        let hourly = Hourly::from_json(&serde_json::json!({
            "surface_pressure": [null, 950],
            "visibility": ["NaN", "Infinity", "-Infinity", 1000],
            "cloud_cover_850hPa": [0]
        }));
        assert_eq!(num_at(&hourly, "missing", 0), None);
        assert_eq!(num_at(&hourly, "surface_pressure", 0), None);
        assert_eq!(num_at(&hourly, "surface_pressure", 1), Some(950.0));
        assert_eq!(num_at(&hourly, "visibility", 0), None);
        assert_eq!(num_at(&hourly, "visibility", 1), None);
        assert_eq!(num_at(&hourly, "visibility", 2), None);
        assert_eq!(num_at(&hourly, "visibility", 3), Some(1000.0));
        assert_eq!(num_at(&hourly, "cloud_cover_850hPa", 0), Some(0.0));
        assert_eq!(num_at(&hourly, "surface_pressure", 5), None);
    }

    #[test]
    fn maps_faa_categories_from_ft_agl() {
        assert_eq!(BKN_CLOUD_COVER_PCT, 62.5);
        assert_eq!(ceiling_category_from_ft_agl(Some(400.0), None), "LIFR");
        assert_eq!(ceiling_category_from_ft_agl(Some(800.0), None), "IFR");
        assert_eq!(ceiling_category_from_ft_agl(Some(2000.0), None), "MVFR");
        assert_eq!(ceiling_category_from_ft_agl(Some(4000.0), None), "VFR");
        assert_eq!(ceiling_category_from_ft_agl(Some(500.0), None), "IFR");
        assert_eq!(ceiling_category_from_ft_agl(Some(1000.0), None), "MVFR");
        assert_eq!(ceiling_category_from_ft_agl(Some(3000.0), None), "MVFR");
        assert_eq!(flight_category_from_wx(Some(500.0), Some(10_000.0)), "LIFR");
        assert_eq!(category_color("VFR"), "#22c55e");
        assert_eq!(category_color("UNK"), "#94a3b8");
    }

    #[test]
    fn interpolates_bkn_crossing_between_levels() {
        let (value, hourly) = hourly_from("ceiling-recorded-interpolate");
        let base = interpolate_cloud_base_msl(
            &hourly,
            index_of(&value),
            f64_field(&value, "terrainElevM"),
            f64_field(&value, "surfaceHpa"),
        );
        assert_eq!(base.method, CeilingMethod::Interpolated);
        let height = base.base_msl_m.expect("base");
        assert!(height > 700.0 && height < 820.0, "{height}");
    }

    #[test]
    fn ignores_underground_1000_975_artefacts() {
        let (value, hourly) = hourly_from("ceiling-recorded-underground");
        let sample =
            ceiling_from_hourly(&hourly, index_of(&value), f64_field(&value, "terrainElevM"));
        assert_eq!(sample.method, CeilingMethod::Interpolated);
        assert!(sample.cloud_base_msl_m.expect("base") > 850.0);
        assert!(!sample.obscured);
    }

    #[test]
    fn no_ceiling_when_low_cloud_without_bkn() {
        let (value, hourly) = hourly_from("ceiling-low-cloud-unresolved");
        let sample =
            ceiling_from_hourly(&hourly, index_of(&value), f64_field(&value, "terrainElevM"));
        assert!(sample.ceiling_ft_agl.is_none());
        assert!(sample.low_cloud_unresolved);
        assert_ne!(sample.ceiling_category, "LIFR");
        let json = String::from_utf8(sample.to_json_bytes()).unwrap();
        assert!(json.contains("\"ceilingFtAgl\":null"));
        assert!(json.contains("\"cloudBaseMslM\":null"));
        assert!(!json.contains("\"ceilingFtAgl\":0"));
    }

    #[test]
    fn first_moist_level_140m_agl_is_not_obscured() {
        let (value, hourly) = hourly_from("ceiling-moist-140m");
        let sample =
            ceiling_from_hourly(&hourly, index_of(&value), f64_field(&value, "terrainElevM"));
        assert!(sample.ceiling_ft_agl.expect("feet") > 100.0);
        assert!(!sample.obscured);
    }

    #[test]
    fn icon_convective_base_ignored_without_backing() {
        let (value, hourly) = hourly_from("ceiling-convective-ignored");
        let sample =
            ceiling_from_hourly(&hourly, index_of(&value), f64_field(&value, "terrainElevM"));
        assert_ne!(sample.cloud_base_msl_m, Some(1200.0));
    }

    #[test]
    fn icon_cape_alone_is_few_not_a_ceiling() {
        let (value, hourly) = hourly_from("ceiling-cape-only");
        let sample =
            ceiling_from_hourly(&hourly, index_of(&value), f64_field(&value, "terrainElevM"));
        assert!(sample.ceiling_ft_agl.is_none());
        assert!(sample.cloud_base_msl_m.is_none());
        let layer = sample.cape_only_layer.expect("layer");
        assert_eq!(layer.cover, "FEW");
        assert!(
            layer.ft_agl > 2000.0 && layer.ft_agl < 2600.0,
            "{}",
            layer.ft_agl
        );
    }

    #[test]
    fn icon_convective_base_used_when_showers_back_it() {
        let (value, hourly) = hourly_from("ceiling-showers");
        let sample =
            ceiling_from_hourly(&hourly, index_of(&value), f64_field(&value, "terrainElevM"));
        assert_eq!(sample.cloud_base_msl_m, Some(1200.0));
        assert_eq!(sample.method, CeilingMethod::CloudBaseField);
    }

    #[test]
    fn negative_convective_base_and_negative_terrain_do_not_invent_zero() {
        let (value, hourly) = hourly_from("ceiling-nulls-negatives");
        let sample =
            ceiling_from_hourly(&hourly, index_of(&value), f64_field(&value, "terrainElevM"));
        let base = sample.cloud_base_msl_m.expect("negative base");
        assert!(base < 0.0, "{base}");
        assert!(sample.ceiling_ft_agl.expect("feet") > 0.0);
        assert_ne!(base, -40.0, "negative convective base must be ignored");
    }

    #[test]
    fn isa_pressure_is_used_when_surface_pressure_is_missing_or_out_of_range() {
        let (_, missing) = hourly_from("ceiling-isa-649");
        let (_, low) = hourly_from("ceiling-isa-out-of-range");
        let (_, present) = hourly_from("ceiling-surface-950-2");
        let isa = surface_pressure_hpa(&missing, 0, 649.0);
        assert_eq!(
            surface_pressure_hpa(&low, 0, 649.0).to_bits(),
            isa.to_bits()
        );
        assert_ne!(isa, 50.0);
        assert_eq!(surface_pressure_hpa(&present, 0, 649.0), 950.2);
        assert!((900.0..960.0).contains(&isa), "{isa}");
    }

    #[test]
    fn low_visibility_can_be_lifr_while_the_ceiling_is_high() {
        let (value, hourly) = hourly_from("ceiling-vis-lifr");
        let sample =
            ceiling_from_hourly(&hourly, index_of(&value), f64_field(&value, "terrainElevM"));
        assert_eq!(sample.ceiling_category, "LIFR");
        assert!(sample.ceiling_ft_agl.expect("feet") > 3000.0);
        assert_eq!(sample.vis_m, Some(1200.0));
    }

    #[test]
    fn fog_replaces_a_higher_stratiform_base() {
        let (value, hourly) = hourly_from("ceiling-fog");
        let sample =
            ceiling_from_hourly(&hourly, index_of(&value), f64_field(&value, "terrainElevM"));
        assert_eq!(sample.method, CeilingMethod::Fog);
        assert!(sample.obscured);
        assert!(sample.ceiling_ft_agl.is_none());
        assert_eq!(sample.cloud_base_msl_m, Some(474.0));
    }

    #[test]
    fn sctb_example_uses_the_focus_elevation() {
        let (value, hourly) = hourly_from("ceiling-sctb-shape");
        assert_eq!(value["focus"]["icao"], "SCTB");
        assert_eq!(f64_field(&value, "terrainElevM"), 649.0);
        let sample = ceiling_from_hourly(&hourly, index_of(&value), 649.0);
        assert_eq!(sample.method, CeilingMethod::Interpolated);
        assert_eq!(sample.vis_m, Some(9000.0));
        assert!(sample.cloud_base_msl_m.is_some());
        assert!(!sample.obscured);
    }

    #[test]
    fn recorded_sctb_night_hour_ignores_the_negative_convective_base() {
        let (value, hourly) = hourly_from("ceiling-sctb-night");
        assert_eq!(value["label"], "recorded");
        assert_eq!(value["validTime"], "2026-11-17T05:00");
        let index = index_of(&value);
        assert_eq!(value["hourly"]["time"][index], "2026-11-17T05:00");
        assert!(value["hourly"]["visibility"][index].is_null());
        assert!(value["hourly"].get("cloud_cover_400hPa").is_none());
        let sample = ceiling_from_hourly(&hourly, index, f64_field(&value, "terrainElevM"));
        assert!(sample.vis_m.is_none());
        assert_ne!(sample.cloud_base_msl_m, Some(-500.0));
        let json = String::from_utf8(sample.to_json_bytes()).unwrap();
        assert!(json.contains("\"visM\":null"), "{json}");
    }

    #[test]
    fn recorded_sctb_missing_field_stays_null() {
        let (value, hourly) = hourly_from("ceiling-sctb-missing-field");
        assert_eq!(value["label"], "recorded");
        let index = index_of(&value);
        assert!(value["hourly"]["visibility"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item.is_null()));
        assert!(value["hourly"].get("geopotential_height_300hPa").is_none());
        assert_eq!(num_at(&hourly, "visibility", index), None);
        assert_eq!(num_at(&hourly, "cloud_cover_400hPa", index), None);
        assert!(num_at(&hourly, "surface_pressure", index).is_some());
        let sample = ceiling_from_hourly(&hourly, index, f64_field(&value, "terrainElevM"));
        assert!(sample.vis_m.is_none());
        let json = String::from_utf8(sample.to_json_bytes()).unwrap();
        assert!(json.contains("\"visM\":null"), "{json}");
        assert!(!json.contains("\"visM\":0"));
    }
}
