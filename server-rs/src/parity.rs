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
    }

    fn render(id: &str) -> Result<Vec<u8>, String> {
        match id {
            "api-health" => Ok(crate::health::body_bytes()),
            other => Err(format!("no Rust renderer for parity case {other}")),
        }
    }

    #[test]
    fn fixtures_match_rust_bytes() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/parity");
        let raw = std::fs::read(root.join("manifest.json")).expect("parity manifest");
        let manifest: Manifest = serde_json::from_slice(&raw).expect("parse parity manifest");
        assert_eq!(manifest.label, "EXAMPLE");
        assert!(!manifest.cases.is_empty());
        for case in manifest.cases {
            assert_eq!(case.label, "EXAMPLE", "{}", case.id);
            let actual = render(&case.id).unwrap_or_else(|err| panic!("{err}"));
            let path = root.join(format!("{}.body", case.id));
            let expected =
                std::fs::read(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()));
            assert_eq!(
                actual,
                expected,
                "{id} differs from the TypeScript fixture\n rust: {rust}\n   ts: {ts}",
                id = case.id,
                rust = String::from_utf8_lossy(&actual),
                ts = String::from_utf8_lossy(&expected),
            );
        }
    }
}
