//! Parity envelope for generated METAR and TAF.
//!
//! The body is `JSON.stringify` of `{ raw, est }` for a METAR, `{ raw, est, format }`
//! for a TAF, or `{ error }` when the TAF cannot be built. `format` is the
//! validator object. Key order matches JavaScript insertion order.

use crate::js_json::Js;
use crate::metar::generate_model_metar;
use crate::rmk::assert_est_only_in_trailing_rmk;
use crate::series::Series;
use crate::taf::generate_model_taf;
use crate::taf_format::assert_model_taf_format;
use serde_json::Value;

pub fn render_parity(value: &Value) -> Result<Vec<u8>, String> {
    let op = value["op"]
        .as_str()
        .ok_or_else(|| "parity input missing op".to_string())?;
    match op {
        "generateModelMetar" => render_metar(value),
        "generateModelTaf" => render_taf(value),
        "assertModelTafFormat" => {
            let raw = value["raw"]
                .as_str()
                .ok_or_else(|| "parity input missing raw".to_string())?;
            Ok(format_js(&assert_model_taf_format(raw)))
        }
        other => Err(format!("unknown parity op {other}")),
    }
}

fn render_metar(value: &Value) -> Result<Vec<u8>, String> {
    let series = Series::from_json(&value["hourly"]);
    let product = generate_model_metar(
        required_str(value, "icao")?,
        required_f64(value, "elevM")?,
        required_str(value, "model")?,
        required_str(value, "runTime")?,
        required_str(value, "validTime")?,
        &series,
        hour_index(value),
    )?;
    let est_error = assert_est_only_in_trailing_rmk(&product.raw).err();
    let est = est_js(est_error.as_deref());
    Ok(Js::Obj(vec![("raw", Js::Str(&product.raw)), ("est", est)]).to_bytes())
}

fn render_taf(value: &Value) -> Result<Vec<u8>, String> {
    let series = Series::from_json(&value["hourly"]);
    match generate_model_taf(
        required_str(value, "icao")?,
        required_f64(value, "elevM")?,
        required_str(value, "model")?,
        required_str(value, "runTime")?,
        &series,
    ) {
        Ok(product) => {
            let est_error = assert_est_only_in_trailing_rmk(&product.raw).err();
            let format = assert_model_taf_format(&product.raw);
            let est = est_js(est_error.as_deref());
            let format_js = format_value(&format);
            Ok(Js::Obj(vec![
                ("raw", Js::Str(&product.raw)),
                ("est", est),
                ("format", format_js),
            ])
            .to_bytes())
        }
        Err(error) => Ok(Js::Obj(vec![("error", Js::Str(&error))]).to_bytes()),
    }
}

fn est_js(error: Option<&str>) -> Js<'_> {
    match error {
        None => Js::Obj(vec![("ok", Js::Bool(true))]),
        Some(error) => Js::Obj(vec![("ok", Js::Bool(false)), ("error", Js::Str(error))]),
    }
}

fn format_value(format: &crate::taf_format::TafFormat) -> Js<'_> {
    match format {
        crate::taf_format::TafFormat::Pass { warnings } => Js::Obj(vec![
            ("ok", Js::Bool(true)),
            ("warnings", string_array(warnings)),
        ]),
        crate::taf_format::TafFormat::Fail { reasons, warnings } => Js::Obj(vec![
            ("ok", Js::Bool(false)),
            ("reasons", string_array(reasons)),
            ("warnings", string_array(warnings)),
        ]),
    }
}

fn format_js(format: &crate::taf_format::TafFormat) -> Vec<u8> {
    format_value(format).to_bytes()
}

fn string_array(items: &[String]) -> Js<'_> {
    Js::Arr(items.iter().map(|item| Js::Str(item)).collect())
}

fn required_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| format!("parity input missing {key}"))
}

fn required_f64(value: &Value, key: &str) -> Result<f64, String> {
    value[key]
        .as_f64()
        .ok_or_else(|| format!("parity input missing {key}"))
}

fn hour_index(value: &Value) -> usize {
    value
        .get("hourIndex")
        .and_then(Value::as_u64)
        .or_else(|| value.get("index").and_then(Value::as_u64))
        .unwrap_or(0) as usize
}
