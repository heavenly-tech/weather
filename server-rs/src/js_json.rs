//! `JSON.stringify` for the numbers and objects the ceiling port emits.
//!
//! `serde_json` prints `1800.0` and `-0.0`. JavaScript prints `1800` and `0`.
//! Integers inside the safe range stay bare, and the scientific-notation
//! threshold matches ECMA-262 (`1e-7`, `1e+21`).

/// Format `n` the way `JSON.stringify` formats a JavaScript number.
///
/// Non-finite values become `null`, which is what `JSON.stringify` substitutes
/// for `NaN` and the infinities. Signed zero becomes `0`.
pub fn format_js_number(n: f64) -> String {
    if !n.is_finite() {
        return "null".to_string();
    }
    if n == 0.0 {
        return "0".to_string();
    }
    let display = format!("{n}");
    if display.contains('e') || display.contains('E') {
        return normalize_exponent(&display);
    }
    if js_uses_decimal(&display) {
        return display;
    }
    scientific_from_decimal(&display)
}

/// `JSON.stringify` keeps a decimal when the exponent is in `-6..=20`.
fn js_uses_decimal(display: &str) -> bool {
    let magnitude = display.strip_prefix('-').unwrap_or(display);
    if let Some(frac) = magnitude.strip_prefix("0.") {
        let zeros = frac.chars().take_while(|c| *c == '0').count();
        return zeros < 6;
    }
    if magnitude.contains('.') {
        return true;
    }
    magnitude.len() <= 21
}

fn scientific_from_decimal(display: &str) -> String {
    let negative = display.starts_with('-');
    let magnitude = display.strip_prefix('-').unwrap_or(display);
    let (int_part, frac_part) = magnitude.split_once('.').unwrap_or((magnitude, ""));
    let exp = if int_part.chars().all(|c| c == '0') {
        let zeros = frac_part.chars().take_while(|c| *c == '0').count();
        -((zeros as i32) + 1)
    } else {
        i32::try_from(int_part.len()).unwrap_or(0) - 1
    };
    let digits: String = int_part.chars().chain(frac_part.chars()).collect();
    let first = digits.find(|c: char| c != '0').unwrap_or(0);
    let mut significant = digits[first..].to_string();
    while significant.len() > 1 && significant.ends_with('0') {
        significant.pop();
    }
    let mantissa = if significant.len() == 1 {
        significant
    } else {
        let mut out = String::new();
        out.push(significant.as_bytes()[0] as char);
        out.push('.');
        out.push_str(&significant[1..]);
        out
    };
    let sign = if negative { "-" } else { "" };
    let exp_text = if exp >= 0 {
        format!("+{exp}")
    } else {
        exp.to_string()
    };
    format!("{sign}{mantissa}e{exp_text}")
}

fn normalize_exponent(display: &str) -> String {
    let Some((mantissa, exp)) = display.split_once(['e', 'E']) else {
        return display.to_string();
    };
    let Ok(exp) = exp.parse::<i32>() else {
        return display.to_string();
    };
    let mantissa = mantissa.strip_suffix(".0").unwrap_or(mantissa);
    let exp_text = if exp >= 0 {
        format!("+{exp}")
    } else {
        exp.to_string()
    };
    format!("{mantissa}e{exp_text}")
}

pub enum Js<'a> {
    Null,
    Bool(bool),
    Num(f64),
    Str(&'a str),
    Arr(Vec<Js<'a>>),
    Obj(Vec<(&'a str, Js<'a>)>),
}

pub fn js_opt_num(value: Option<f64>) -> Js<'static> {
    match value {
        Some(number) if number.is_finite() => Js::Num(number),
        _ => Js::Null,
    }
}

impl Js<'_> {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = String::new();
        push_json(&mut out, self);
        out.into_bytes()
    }
}

fn push_json(out: &mut String, value: &Js<'_>) {
    match value {
        Js::Null => out.push_str("null"),
        Js::Bool(true) => out.push_str("true"),
        Js::Bool(false) => out.push_str("false"),
        Js::Num(number) => out.push_str(&format_js_number(*number)),
        Js::Str(text) => push_string(out, text),
        Js::Arr(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                push_json(out, item);
            }
            out.push(']');
        }
        Js::Obj(fields) => {
            out.push('{');
            for (index, (key, item)) in fields.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                push_string(out, key);
                out.push(':');
                push_json(out, item);
            }
            out.push('}');
        }
    }
}

fn push_string(out: &mut String, text: &str) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => write_unicode_escape(out, c),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write_unicode_escape(out: &mut String, ch: char) {
    use std::fmt::Write as _;
    let _ = write!(out, "\\u{:04x}", ch as u32);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integers_have_no_decimal_and_signed_zero_is_zero() {
        assert_eq!(format_js_number(1800.0), "1800");
        assert_eq!(format_js_number(-70.0), "-70");
        assert_eq!(format_js_number(0.0), "0");
        assert_eq!(format_js_number(-0.0), "0");
        assert_eq!(format_js_number(1.0), "1");
        assert_eq!(format_js_number(62.5), "62.5");
        assert_eq!(format_js_number(-1.5), "-1.5");
        assert_eq!(format_js_number(f64::NAN), "null");
        assert_eq!(format_js_number(f64::INFINITY), "null");
        assert_eq!(format_js_number(f64::NEG_INFINITY), "null");
    }

    #[test]
    fn exponent_threshold_matches_json_stringify() {
        assert_eq!(format_js_number(1e-6), "0.000001");
        assert_eq!(format_js_number(1e-7), "1e-7");
        assert_eq!(format_js_number(1e-10), "1e-10");
        assert_eq!(format_js_number(1.23e-7), "1.23e-7");
        assert_eq!(format_js_number(5e-7), "5e-7");
        assert_eq!(format_js_number(9.87654321e-8), "9.87654321e-8");
        assert_eq!(format_js_number(1e20), "100000000000000000000");
        assert_eq!(format_js_number(1e21), "1e+21");
        assert_eq!(format_js_number(1e22), "1e+22");
        assert_eq!(format_js_number(-1e21), "-1e+21");
        assert_eq!(format_js_number(1.23e21), "1.23e+21");
        assert_eq!(format_js_number(5e-324), "5e-324");
        assert_eq!(format_js_number(f64::MAX), "1.7976931348623157e+308");
        assert_eq!(
            format_js_number(f64::MIN_POSITIVE),
            "2.2250738585072014e-308"
        );
    }

    #[test]
    fn ceiling_products_match_node() {
        const M_TO_FT: f64 = 3.280839895;
        assert_eq!(format_js_number(649.0 * M_TO_FT), "2129.2650918550003");
        assert_eq!(format_js_number(0.1 * M_TO_FT), "0.32808398950000006");
        let isa = 1013.25_f64 * (1.0_f64 - 649.0_f64 / 44330.0_f64).powf(5.255);
        assert_eq!(format_js_number(isa), "937.6861502395573");
        assert_eq!(format_js_number(-32.1), "-32.1");
        assert_eq!(format_js_number(-34.8), "-34.8");
        assert_eq!(format_js_number(-71.8), "-71.8");
        assert_eq!(format_js_number(3.280839895), "3.280839895");
    }

    #[test]
    fn fine_grid_edges_match_node() {
        let lat = |fr: f64| -32.1 + (fr / 43.0) * (-34.8 - -32.1);
        let lon = |fc: f64| -71.8 + (fc / 31.0) * (-70.0 - -71.8);
        assert_eq!(format_js_number(lat(0.0)), "-32.1");
        assert_eq!(format_js_number(lat(1.0)), "-32.16279069767442");
        assert_eq!(format_js_number(lat(43.0)), "-34.8");
        assert_eq!(format_js_number(lon(0.0)), "-71.8");
        assert_eq!(format_js_number(lon(1.0)), "-71.74193548387096");
        assert_eq!(format_js_number(lon(31.0)), "-70");
    }

    #[test]
    fn node_samples_format_without_trailing_point_zero() {
        // `serde_json` and Rust's `FromStr` disagree by an ulp on some long
        // decimals. The standard parser matches V8 on this fixture.
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/js-json-numbers.json");
        let raw =
            std::fs::read(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
        let samples: Vec<String> = serde_json::from_slice(&raw).expect("js number fixture");
        assert!(
            samples.len() > 50,
            "fixture should cover more than the hand-picked edges"
        );
        for sample in &samples {
            let parsed: f64 = sample.parse().unwrap_or_else(|_| panic!("parse {sample}"));
            assert_eq!(format_js_number(parsed), *sample, "bits {parsed:?}");
        }
    }

    #[test]
    fn objects_are_compact_and_keep_null() {
        let value = Js::Obj(vec![
            ("ceilingFtAgl", Js::Null),
            ("n", Js::Num(1800.0)),
            ("label", Js::Str("EXAMPLE")),
        ]);
        assert_eq!(
            String::from_utf8(value.to_bytes()).unwrap(),
            r#"{"ceilingFtAgl":null,"n":1800,"label":"EXAMPLE"}"#
        );
    }
}
