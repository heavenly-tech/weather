//! Port of `src/lib/andes/ceiling-regrid.ts`.
//!
//! The fine value is the minimum base and the maximum precip across the four
//! floor corners. Fractional weights are not used. Latitude runs from -32.1
//! down to -34.8 and longitude from -71.8 to -70.0.

use crate::ceiling::{ceiling_category_from_ft_agl, parse_json_number, M_TO_FT};
use crate::js_json::{js_opt_num, Js};
use serde::Deserialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

const OBSC_EPS_M: f64 = 5.0;
const ANDES_LAT_MIN: f64 = -34.8;
const ANDES_LAT_MAX: f64 = -32.1;
const ANDES_LON_MIN: f64 = -71.8;
const ANDES_LON_MAX: f64 = -70.0;

pub const ELEVATION_MISSING: &str =
    "Static fine elevation grid missing — run scripts/generate-andes-elevation.ts";

#[derive(Clone, Debug)]
pub struct CoarseSample {
    pub lat: f64,
    pub lon: f64,
    pub base_msl_m: Option<f64>,
    pub obscured: bool,
    pub low_cloud_unresolved: bool,
    pub precip_mm_h: Option<f64>,
}

pub fn coarse_from_json(value: &Value) -> Result<CoarseSample, String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "coarse sample must be an object".to_string())?;
    let number = |key: &str| obj.get(key).and_then(parse_json_number);
    Ok(CoarseSample {
        lat: number("lat").unwrap_or(0.0),
        lon: number("lon").unwrap_or(0.0),
        base_msl_m: match obj.get("baseMslM") {
            None | Some(Value::Null) => None,
            Some(item) => parse_json_number(item),
        },
        obscured: obj
            .get("obscured")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        low_cloud_unresolved: obj
            .get("lowCloudUnresolved")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        precip_mm_h: match obj.get("precipMmH") {
            None | Some(Value::Null) => None,
            Some(item) => parse_json_number(item),
        },
    })
}

pub fn corners_from_json(value: &Value) -> Result<Vec<Option<CoarseSample>>, String> {
    let items = value
        .as_array()
        .ok_or_else(|| "corners must be an array".to_string())?;
    items
        .iter()
        .map(|item| {
            if item.is_null() {
                Ok(None)
            } else {
                coarse_from_json(item).map(Some)
            }
        })
        .collect()
}

pub fn cells_from_json(value: &Value) -> Result<Vec<CoarseSample>, String> {
    let items = value
        .as_array()
        .ok_or_else(|| "cells must be an array".to_string())?;
    items.iter().map(coarse_from_json).collect()
}

#[derive(Clone, Copy, Debug)]
pub struct Neighbourhood {
    pub base_msl_m: Option<f64>,
    pub precip_mm_h: Option<f64>,
    pub low_cloud_unresolved: bool,
}

impl Neighbourhood {
    pub fn to_json_bytes(&self) -> Vec<u8> {
        Js::Obj(vec![
            ("baseMslM", js_opt_num(self.base_msl_m)),
            ("precipMmH", js_opt_num(self.precip_mm_h)),
            ("lowCloudUnresolved", Js::Bool(self.low_cloud_unresolved)),
        ])
        .to_bytes()
    }
}

/// `Math.min`. An empty list is null. Any NaN poisons the result.
fn js_min(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut acc = f64::INFINITY;
    for &value in values {
        if value.is_nan() {
            return Some(f64::NAN);
        }
        if value < acc {
            acc = value;
        }
    }
    Some(acc)
}

/// `Math.max` over the finite precip rates. An empty list is null.
fn js_max(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut acc = f64::NEG_INFINITY;
    for &value in values {
        if value.is_nan() {
            return Some(f64::NAN);
        }
        if value > acc {
            acc = value;
        }
    }
    Some(acc)
}

pub fn neighbourhood_base_and_precip(corners: &[Option<CoarseSample>]) -> Neighbourhood {
    let mut bases = Vec::new();
    let mut precips = Vec::new();
    let mut low_cloud_unresolved = false;
    for sample in corners.iter().flatten() {
        if let Some(base) = sample.base_msl_m {
            bases.push(base);
        }
        if let Some(rate) = sample.precip_mm_h {
            if rate.is_finite() {
                precips.push(rate);
            }
        }
        if sample.low_cloud_unresolved {
            low_cloud_unresolved = true;
        }
    }
    Neighbourhood {
        base_msl_m: js_min(&bases),
        precip_mm_h: js_max(&precips),
        low_cloud_unresolved,
    }
}

#[derive(Clone, Debug)]
pub struct FineCell {
    pub lat: f64,
    pub lon: f64,
    pub elev_m: f64,
    pub ceiling_ft_agl: Option<f64>,
    pub category: &'static str,
    pub obscured: bool,
    pub cloud_base_msl_m: Option<f64>,
    pub low_cloud_unresolved: bool,
    pub precip_mm_h: Option<f64>,
    pub omit_precip: bool,
}

impl FineCell {
    fn to_js(&self) -> Js<'_> {
        let mut fields = vec![
            ("lat", Js::Num(self.lat)),
            ("lon", Js::Num(self.lon)),
            ("elevM", Js::Num(self.elev_m)),
            ("ceilingFtAgl", js_opt_num(self.ceiling_ft_agl)),
            ("category", Js::Str(self.category)),
            ("obscured", Js::Bool(self.obscured)),
            ("cloudBaseMslM", js_opt_num(self.cloud_base_msl_m)),
            ("lowCloudUnresolved", Js::Bool(self.low_cloud_unresolved)),
        ];
        if !self.omit_precip {
            fields.push(("precipMmH", js_opt_num(self.precip_mm_h)));
        }
        Js::Obj(fields)
    }
}

#[derive(Clone, Debug)]
pub struct FineGrid {
    pub cells: Vec<FineCell>,
    pub rows: usize,
    pub cols: usize,
}

impl FineGrid {
    pub fn to_json_bytes(&self) -> Vec<u8> {
        Js::Obj(vec![
            (
                "cells",
                Js::Arr(self.cells.iter().map(FineCell::to_js).collect()),
            ),
            ("rows", Js::Num(self.rows as f64)),
            ("cols", Js::Num(self.cols as f64)),
        ])
        .to_bytes()
    }
}

fn render_subdiv() -> usize {
    match std::env::var("ANDES_RENDER_SUBDIV") {
        Ok(raw) => raw.parse::<usize>().unwrap_or(0),
        Err(_) => 4,
    }
}

#[derive(Deserialize)]
struct ElevBlob {
    #[serde(rename = "coarseRows")]
    coarse_rows: usize,
    #[serde(rename = "coarseCols")]
    coarse_cols: usize,
    subdiv: usize,
    elevations: Vec<Option<f64>>,
}

pub fn elevation_path() -> PathBuf {
    if let Some(path) = std::env::var_os("WEATHER_ELEVATION") {
        return PathBuf::from(path);
    }
    let bundled =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/andes-fine-elevation.json");
    if bundled.is_file() {
        bundled
    } else {
        PathBuf::from("data/andes-fine-elevation.json")
    }
}

fn load_blob(path: &Path) -> Result<ElevBlob, String> {
    let raw = std::fs::read(path).map_err(|err| format!("{ELEVATION_MISSING}: {err}"))?;
    serde_json::from_slice(&raw).map_err(|err| format!("{ELEVATION_MISSING}: {err}"))
}

fn static_fine_elevations(
    coarse_rows: usize,
    coarse_cols: usize,
    subdiv: usize,
) -> Result<Vec<Option<f64>>, String> {
    let blob = load_blob(&elevation_path())?;
    let fine_rows = coarse_rows.saturating_mul(subdiv);
    let fine_cols = coarse_cols.saturating_mul(subdiv);
    if blob.coarse_rows != coarse_rows
        || blob.coarse_cols != coarse_cols
        || blob.subdiv != subdiv
        || blob.elevations.len() != fine_rows * fine_cols
    {
        return Err(ELEVATION_MISSING.to_string());
    }
    Ok(blob.elevations)
}

fn floor_usize(value: f64) -> usize {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    let floored = value.floor();
    if floored >= usize::MAX as f64 {
        return usize::MAX;
    }
    floored as usize
}

fn bad_cell(lat: f64, lon: f64) -> FineCell {
    FineCell {
        lat,
        lon,
        elev_m: 0.0,
        ceiling_ft_agl: None,
        category: "UNK",
        obscured: false,
        cloud_base_msl_m: None,
        low_cloud_unresolved: true,
        precip_mm_h: None,
        omit_precip: true,
    }
}

fn refine_with_elevations(
    coarse_cells: &[CoarseSample],
    coarse_rows: usize,
    coarse_cols: usize,
    subdiv: usize,
    elevs: &[Option<f64>],
) -> FineGrid {
    let fine_rows = coarse_rows.saturating_mul(subdiv);
    let fine_cols = coarse_cols.saturating_mul(subdiv);
    if coarse_rows == 0 || coarse_cols == 0 || subdiv == 0 {
        return FineGrid {
            cells: Vec::new(),
            rows: fine_rows,
            cols: fine_cols,
        };
    }

    let mut matrix = vec![None; coarse_rows * coarse_cols];
    for (index, cell) in coarse_cells.iter().enumerate() {
        let row = index / coarse_cols;
        let col = index % coarse_cols;
        if row < coarse_rows {
            matrix[row * coarse_cols + col] = Some(cell.clone());
        }
    }

    let mut cells = Vec::with_capacity(fine_rows * fine_cols);
    let row_denom = (fine_rows - 1).max(1) as f64;
    let col_denom = (fine_cols - 1).max(1) as f64;
    for fr in 0..fine_rows {
        let lat = ANDES_LAT_MAX + (fr as f64 / row_denom) * (ANDES_LAT_MIN - ANDES_LAT_MAX);
        for fc in 0..fine_cols {
            let lon = ANDES_LON_MIN + (fc as f64 / col_denom) * (ANDES_LON_MAX - ANDES_LON_MIN);
            let elev = elevs.get(fr * fine_cols + fc).copied().flatten();
            let Some(elev_m) = elev.filter(|value| value.is_finite()) else {
                cells.push(bad_cell(lat, lon));
                continue;
            };

            let gr = (fr as f64 / row_denom) * (coarse_rows - 1) as f64;
            let gc = (fc as f64 / col_denom) * (coarse_cols - 1) as f64;
            let r0 = floor_usize(gr);
            let c0 = floor_usize(gc);
            let r1 = (r0 + 1).min(coarse_rows - 1);
            let c1 = (c0 + 1).min(coarse_cols - 1);
            let at = |row: usize, col: usize| -> Option<CoarseSample> {
                if row >= coarse_rows || col >= coarse_cols {
                    None
                } else {
                    matrix[row * coarse_cols + col].clone()
                }
            };
            let neighbourhood =
                neighbourhood_base_and_precip(&[at(r0, c0), at(r0, c1), at(r1, c0), at(r1, c1)]);
            let mut ceiling_ft_agl = None;
            let mut obscured = false;
            if let Some(base) = neighbourhood.base_msl_m {
                obscured = base <= elev_m + OBSC_EPS_M;
                let agl = base - elev_m;
                if agl > 0.0 {
                    ceiling_ft_agl = Some(agl * M_TO_FT);
                }
            }
            let unresolved = neighbourhood.low_cloud_unresolved && ceiling_ft_agl.is_none();
            let category = if unresolved {
                "UNK"
            } else {
                ceiling_category_from_ft_agl(ceiling_ft_agl, None)
            };
            cells.push(FineCell {
                lat,
                lon,
                elev_m,
                ceiling_ft_agl,
                category,
                obscured,
                cloud_base_msl_m: neighbourhood.base_msl_m,
                low_cloud_unresolved: unresolved,
                precip_mm_h: neighbourhood.precip_mm_h,
                omit_precip: false,
            });
        }
    }

    FineGrid {
        cells,
        rows: fine_rows,
        cols: fine_cols,
    }
}

pub fn refine_ceiling_grid(
    coarse_cells: &[CoarseSample],
    coarse_rows: usize,
    coarse_cols: usize,
) -> Result<FineGrid, String> {
    let subdiv = render_subdiv();
    let elevs = static_fine_elevations(coarse_rows, coarse_cols, subdiv)?;
    Ok(refine_with_elevations(
        coarse_cells,
        coarse_rows,
        coarse_cols,
        subdiv,
        &elevs,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::js_json::format_js_number;

    fn sample(base: Option<f64>, precip: Option<f64>, unresolved: bool) -> CoarseSample {
        CoarseSample {
            lat: 0.0,
            lon: 0.0,
            base_msl_m: base,
            obscured: false,
            low_cloud_unresolved: unresolved,
            precip_mm_h: precip,
        }
    }

    #[test]
    fn keeps_lowest_base_and_highest_precip() {
        let value = crate::parity_eval::load_example("neighbourhood-min-base");
        let corners = corners_from_json(&value["corners"]).unwrap();
        let agg = neighbourhood_base_and_precip(&corners);
        assert_eq!(agg.base_msl_m, Some(1500.0));
        assert_eq!(agg.precip_mm_h, Some(4.2));
    }

    #[test]
    fn negative_base_is_kept_and_nan_precip_is_ignored() {
        let value = crate::parity_eval::load_example("neighbourhood-nulls-negatives");
        let corners = corners_from_json(&value["corners"]).unwrap();
        let agg = neighbourhood_base_and_precip(&corners);
        assert_eq!(agg.base_msl_m, Some(-20.0));
        assert_eq!(agg.precip_mm_h, Some(0.0));
        assert!(agg.low_cloud_unresolved);
        assert_eq!(format_js_number(agg.base_msl_m.unwrap()), "-20");
    }

    #[test]
    fn nan_base_poisons_the_minimum_the_way_math_min_does() {
        let value = crate::parity_eval::load_example("neighbourhood-nan-base");
        let corners = corners_from_json(&value["corners"]).unwrap();
        let agg = neighbourhood_base_and_precip(&corners);
        assert!(agg.base_msl_m.expect("nan").is_nan());
        let json = String::from_utf8(agg.to_json_bytes()).unwrap();
        assert!(json.contains("\"baseMslM\":null"), "{json}");
    }

    #[test]
    fn min_base_is_not_an_average_of_the_corners() {
        let agg = neighbourhood_base_and_precip(&[
            Some(sample(Some(1500.0), Some(4.2), false)),
            Some(sample(None, Some(0.0), false)),
            None,
            Some(sample(Some(3200.0), Some(0.1), false)),
        ]);
        assert_eq!(agg.base_msl_m, Some(1500.0));
        assert_ne!(agg.base_msl_m, Some((1500.0 + 3200.0) / 2.0));
        assert_eq!(agg.precip_mm_h, Some(4.2));
    }

    #[test]
    fn bad_elevation_is_unk_and_real_negative_elevation_is_kept() {
        let bad =
            refine_with_elevations(&[sample(Some(1800.0), Some(1.0), false)], 1, 1, 1, &[None]);
        let json = String::from_utf8(bad.to_json_bytes()).unwrap();
        assert_eq!(
            json,
            r#"{"cells":[{"lat":-32.1,"lon":-71.8,"elevM":0,"ceilingFtAgl":null,"category":"UNK","obscured":false,"cloudBaseMslM":null,"lowCloudUnresolved":true}],"rows":1,"cols":1}"#
        );
        let nan = refine_with_elevations(&[], 1, 1, 1, &[Some(f64::NAN)]);
        assert_eq!(nan.cells[0].category, "UNK");
        assert!(nan.cells[0].omit_precip);
        let negative = refine_with_elevations(&[], 1, 1, 1, &[Some(-5.0)]);
        assert_eq!(negative.cells[0].elev_m, -5.0);
        assert_eq!(negative.cells[0].category, "VFR");
        assert!(!negative.cells[0].omit_precip);
        assert!(negative.cells[0].cloud_base_msl_m.is_none());
    }

    #[test]
    fn wrong_grid_shape_is_the_typescript_hard_error() {
        let err = refine_ceiling_grid(&[], 2, 2).unwrap_err();
        assert_eq!(err, ELEVATION_MISSING);
    }

    #[test]
    fn isolated_cell_survives_and_edges_are_the_domain_corners() {
        let value = crate::parity_eval::load_example("regrid-isolated-cell");
        let cells = cells_from_json(&value["cells"]).unwrap();
        let rows = value["rows"].as_u64().unwrap() as usize;
        let cols = value["cols"].as_u64().unwrap() as usize;
        let grid = refine_ceiling_grid(&cells, rows, cols).unwrap();
        assert_eq!(grid.rows, 44);
        assert_eq!(grid.cols, 32);
        assert_eq!(grid.cells.len(), 1408);
        let first = &grid.cells[0];
        let last = grid.cells.last().unwrap();
        assert_eq!(format_js_number(first.lat), "-32.1");
        assert_eq!(format_js_number(first.lon), "-71.8");
        assert_eq!(format_js_number(last.lat), "-34.8");
        assert_eq!(format_js_number(last.lon), "-70");
        assert_eq!(first.elev_m, 0.0);
        assert_eq!(first.category, "VFR");
        assert!(!first.low_cloud_unresolved);
        assert!(!first.omit_precip);
        let with_base = grid
            .cells
            .iter()
            .filter(|cell| cell.cloud_base_msl_m == Some(1800.0))
            .count();
        let with_precip = grid
            .cells
            .iter()
            .filter(|cell| cell.precip_mm_h == Some(6.0))
            .count();
        assert!(with_base > 0, "isolated base disappeared");
        assert!(with_precip > 0, "isolated precip disappeared");
        assert!(with_base < grid.cells.len() / 2);
    }
}
