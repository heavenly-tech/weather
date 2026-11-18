//! JavaScript `Math.round`: the nearest integer, with halves toward +infinity.
//! Rust `f64::round` sends halves away from zero, so `-1.5` becomes `-2`.
//! SCTB temperatures are negative; every `Math.round` site in the TypeScript
//! port has to go through this helper.

/// Round `n` the way ECMA-262 `Math.round` does.
///
/// `NaN`, infinities, and signed zeroes pass through. Values in `(0, 0.5)`
/// become `+0`, and values in `[-0.5, 0)` become `-0`.
pub fn js_round(n: f64) -> f64 {
    if !n.is_finite() || n == 0.0 {
        return n;
    }
    if n > 0.0 && n < 0.5 {
        return 0.0;
    }
    if (-0.5..0.0).contains(&n) {
        return -0.0;
    }
    (n + 0.5).floor()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::path::PathBuf;

    #[derive(Deserialize)]
    struct Fixture {
        label: String,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        input: String,
        output: String,
        neg_zero: bool,
    }

    fn fixture() -> Fixture {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/js-round.json");
        let raw =
            std::fs::read(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
        serde_json::from_slice(&raw).expect("js-round fixture")
    }

    fn parse_js_number(raw: &str) -> f64 {
        match raw {
            "NaN" => f64::NAN,
            "Infinity" => f64::INFINITY,
            "-Infinity" => f64::NEG_INFINITY,
            "-0" => -0.0,
            other => other
                .parse()
                .unwrap_or_else(|_| panic!("bad fixture number {other}")),
        }
    }

    fn matches(actual: f64, output: &str, neg_zero: bool) -> bool {
        match output {
            "NaN" => actual.is_nan() && !neg_zero,
            "Infinity" => actual.is_infinite() && actual.is_sign_positive() && !neg_zero,
            "-Infinity" => actual.is_infinite() && actual.is_sign_negative() && !neg_zero,
            "0" if neg_zero => actual == 0.0 && actual.is_sign_negative(),
            "0" => actual == 0.0 && actual.is_sign_positive() && !neg_zero,
            other => {
                let expected: f64 = other.parse().expect("fixture output");
                actual == expected && !neg_zero
            }
        }
    }

    #[test]
    fn half_toward_positive_infinity_differs_from_rust_round() {
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!((-1.5_f64).round(), -2.0);
        assert_eq!(js_round(1.5), 2.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(2.5), 3.0);
    }

    #[test]
    fn matches_node_math_round_fixture() {
        let fixture = fixture();
        assert_eq!(fixture.label, "EXAMPLE");
        assert!(!fixture.cases.is_empty());
        for case in fixture.cases {
            let actual = js_round(parse_js_number(&case.input));
            assert!(
                matches(actual, &case.output, case.neg_zero),
                "Math.round({}) was {:?}, fixture output {} neg_zero {}",
                case.input,
                actual,
                case.output,
                case.neg_zero,
            );
        }
    }
}
