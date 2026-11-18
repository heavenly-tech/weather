//! Evaluate a committed TypeScript parity input and emit JSON bytes.
//!
//! The body files next to these inputs were produced by
//! `scripts/capture-ceiling-parity.ts`. `label` is `EXAMPLE` or `recorded`.

use crate::ceiling::{
    ceiling_from_hourly, interpolate_cloud_base_msl, surface_pressure_hpa, Hourly,
};
use crate::js_json::format_js_number;
use crate::regrid::{
    cells_from_json, corners_from_json, neighbourhood_base_and_precip, refine_ceiling_grid,
};
use serde_json::Value;
use std::path::PathBuf;

pub fn load_example(id: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(format!("tests/fixtures/parity/{id}.input.json"));
    let raw = std::fs::read(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
    let value: Value =
        serde_json::from_slice(&raw).unwrap_or_else(|err| panic!("parse {id}: {err}"));
    assert!(
        value["label"] == "EXAMPLE" || value["label"] == "recorded",
        "{id} label {}",
        value["label"]
    );
    value
}

pub fn render_input(value: &Value) -> Result<Vec<u8>, String> {
    if value["label"] != "EXAMPLE" && value["label"] != "recorded" {
        return Err("parity input label must be EXAMPLE or recorded".to_string());
    }
    let op = value["op"]
        .as_str()
        .ok_or_else(|| "parity input missing op".to_string())?;
    let index = value["index"].as_u64().unwrap_or(0) as usize;
    match op {
        "surfacePressureHpa" => {
            let hourly = Hourly::from_json(&value["hourly"]);
            let terrain = required_f64(value, "terrainElevM")?;
            let pressure = surface_pressure_hpa(&hourly, index, terrain);
            Ok(format_js_number(pressure).into_bytes())
        }
        "interpolateCloudBaseMsl" => {
            let hourly = Hourly::from_json(&value["hourly"]);
            let terrain = required_f64(value, "terrainElevM")?;
            let surface = required_f64(value, "surfaceHpa")?;
            Ok(interpolate_cloud_base_msl(&hourly, index, terrain, surface).to_json_bytes())
        }
        "ceilingFromHourly" => {
            let hourly = Hourly::from_json(&value["hourly"]);
            let terrain = required_f64(value, "terrainElevM")?;
            Ok(ceiling_from_hourly(&hourly, index, terrain).to_json_bytes())
        }
        "neighbourhoodBaseAndPrecip" => {
            let corners = corners_from_json(&value["corners"])?;
            Ok(neighbourhood_base_and_precip(&corners).to_json_bytes())
        }
        "refineCeilingGrid" => {
            let cells = cells_from_json(&value["cells"])?;
            let rows = required_usize(value, "rows")?;
            let cols = required_usize(value, "cols")?;
            Ok(refine_ceiling_grid(&cells, rows, cols)?.to_json_bytes())
        }
        other => Err(format!("unknown parity op {other}")),
    }
}

fn required_f64(value: &Value, key: &str) -> Result<f64, String> {
    value[key]
        .as_f64()
        .ok_or_else(|| format!("parity input missing {key}"))
}

fn required_usize(value: &Value, key: &str) -> Result<usize, String> {
    value[key]
        .as_u64()
        .map(|number| number as usize)
        .ok_or_else(|| format!("parity input missing {key}"))
}

pub fn render_case(id: &str) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(format!("tests/fixtures/parity/{id}.input.json"));
    let raw = std::fs::read(&path).map_err(|err| format!("read {id} input: {err}"))?;
    let value: Value =
        serde_json::from_slice(&raw).map_err(|err| format!("parse {id} input: {err}"))?;
    render_input(&value)
}
