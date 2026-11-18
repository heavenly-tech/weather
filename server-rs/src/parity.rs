//! TypeScript and Rust must emit the same response bytes.
//!
//! `tests/fixtures/parity/manifest.json` lists cases. Each case has a sibling
//! `<id>.body` captured from the TypeScript handler. Adding a case without a
//! Rust renderer fails this test. Later ports fill the manifest in; they do
//! not relax the compare.

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use std::path::PathBuf;

    #[derive(Deserialize)]
    struct Manifest {
        label: String,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        id: String,
        label: String,
        #[serde(default)]
        role: Option<String>,
    }

    fn render(id: &str) -> Result<Vec<u8>, String> {
        match id {
            "api-health" => Ok(crate::health::body_bytes()),
            other => crate::parity_eval::render_case(other),
        }
    }

    fn assert_same_bytes(id: &str, actual: &[u8], expected: &[u8]) {
        if actual == expected {
            return;
        }
        let shared = actual.len().min(expected.len());
        let mismatch = actual
            .iter()
            .zip(expected.iter())
            .position(|(left, right)| left != right)
            .unwrap_or(shared);
        let start = mismatch.saturating_sub(80);
        let rust_end = (mismatch + 80).min(actual.len());
        let ts_end = (mismatch + 80).min(expected.len());
        panic!(
            "{id} differs at byte {mismatch} (rust {} bytes, ts {} bytes)\n rust: {}\n   ts: {}",
            actual.len(),
            expected.len(),
            String::from_utf8_lossy(&actual[start.min(actual.len())..rust_end]),
            String::from_utf8_lossy(&expected[start.min(expected.len())..ts_end]),
        );
    }

    #[test]
    fn fixtures_match_rust_bytes() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/parity");
        let raw = std::fs::read(root.join("manifest.json")).expect("parity manifest");
        let manifest: Manifest = serde_json::from_slice(&raw).expect("parse parity manifest");
        assert_eq!(manifest.label, "EXAMPLE");
        assert!(!manifest.cases.is_empty());
        let mut saw_night = false;
        let mut saw_missing = false;
        for case in manifest.cases {
            assert!(
                case.label == "EXAMPLE" || case.label == "recorded",
                "{} label {}",
                case.id,
                case.label
            );
            saw_night |= case.role.as_deref() == Some("night");
            saw_missing |= case.role.as_deref() == Some("missing-field");
            let actual = render(&case.id).unwrap_or_else(|err| panic!("{err}"));
            let path = root.join(format!("{}.body", case.id));
            let expected =
                std::fs::read(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
            assert_same_bytes(&case.id, &actual, &expected);
        }
        assert!(saw_night, "recorded night case missing");
        assert!(saw_missing, "recorded missing-field case missing");
    }
}
