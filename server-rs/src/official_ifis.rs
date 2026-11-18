//! DGAC IFIS (aipchile.dgac.gob.cl) HTML fetch URLs and parsing.

use crate::utc::{parse_utc_iso, UtcStamp};

pub const DGAC_USER_AGENT: &str = "heavenly-weather/0.1 (server-side dgac-ifis cache)";
pub const SOURCE: &str = "dgac-ifis";
pub const OFFICIAL_LABEL: &str = "Oficial DGAC";

pub const METAR_TTL_MS: i64 = 5 * 60 * 1000;
pub const TAF_TTL_MS: i64 = 30 * 60 * 1000;
pub const METAR_STALE_SECS: i64 = 60 * 60;
pub const TAF_STALE_SECS: i64 = 6 * 60 * 60;

pub const GLOBAL_MIN_INTERVAL_MS: i64 = 10_000;
pub const PER_ICAO_MIN_INTERVAL_MS: i64 = 60_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ParseFailure {
    NoMetar,
    NoTaf,
    NoTafForDesignator,
    Malformed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedMetar {
    pub raw: String,
    pub kind: String,
    pub header_issued_at: Option<UtcStamp>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedTaf {
    pub raw: String,
    pub header_issued_at: Option<UtcStamp>,
}

pub fn metar_url(icao: &str) -> String {
    format!(
        "https://aipchile.dgac.gob.cl/metar?metodo=aerodromo&designador={}&boton=Consultar",
        urlencoding_path(icao)
    )
}

pub fn taf_url(icao: &str) -> String {
    format!(
        "https://aipchile.dgac.gob.cl/taf?designador={}",
        urlencoding_path(icao)
    )
}

fn urlencoding_path(icao: &str) -> String {
    icao.chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_uppercase()
}

/// Chilean ICAOs served on the desk, plus Andes/VFR fields called out in PR 2.
pub fn allowed_icao(icao: &str) -> bool {
    let upper = icao.trim().to_ascii_uppercase();
    if upper.len() != 4 {
        return false;
    }
    if crate::stations::station(&upper).is_some() {
        return true;
    }
    if crate::airfields::airfield(&upper).is_some() {
        return true;
    }
    matches!(upper.as_str(), "SCIL" | "SCIC" | "SCTL")
}

pub fn allowed_fir(fir: &str) -> bool {
    matches!(
        fir.trim().to_ascii_uppercase().as_str(),
        "SANTIAGO" | "SCEZ" | "ANTOFAGASTA" | "PUERTO_MONTT"
    )
}

pub fn parse_metar_html(html: &str, icao: &str) -> Result<ParsedMetar, ParseFailure> {
    let want = icao.trim().to_ascii_uppercase();
    let header =
        parse_spanish_header(html, "METAR del ", '-').or_else(|| parse_spanish_header(html, "SPECI del ", '-'));
    for prefix in ["METAR", "SPECI"] {
        if let Some(raw) = extract_bulletin_line(html, prefix, &want) {
            return Ok(ParsedMetar {
                raw,
                kind: prefix.to_string(),
                header_issued_at: header,
            });
        }
    }
    for raw in extract_codification_lines(html) {
        let upper = raw.to_ascii_uppercase();
        if upper.starts_with("METAR ") || upper.starts_with("SPECI ") {
            let parts: Vec<&str> = raw.split_whitespace().collect();
            if parts.len() >= 2 && parts[1].eq_ignore_ascii_case(&want) {
                let kind = parts[0].to_ascii_uppercase();
                return Ok(ParsedMetar {
                    raw: raw.trim().to_string(),
                    kind,
                    header_issued_at: header,
                });
            }
        }
    }
    Err(ParseFailure::NoMetar)
}

pub fn parse_taf_html(html: &str, icao: &str) -> Result<ParsedTaf, ParseFailure> {
    if html.contains("No existe TAF para ese designador") {
        return Err(ParseFailure::NoTafForDesignator);
    }
    let want = icao.trim().to_ascii_uppercase();
    let header = parse_spanish_header(html, "TAF del ", '/');
    if let Some(raw) = extract_bulletin_line(html, "TAF", &want) {
        return Ok(ParsedTaf {
            raw: strip_taf_prefix(&raw),
            header_issued_at: header,
        });
    }
    for raw in extract_codification_lines(html) {
        let upper = raw.to_ascii_uppercase();
        if upper.starts_with("TAF ") {
            let parts: Vec<&str> = raw.split_whitespace().collect();
            if parts.len() >= 2 && parts[1].eq_ignore_ascii_case(&want) {
                return Ok(ParsedTaf {
                    raw: strip_taf_prefix(&raw),
                    header_issued_at: header,
                });
            }
        }
    }
    // IFIS sometimes wraps the line as "TAF: TAF SCEL ..."
    if let Some(pos) = html.find("TAF: TAF ") {
        let slice = &html[pos + 5..];
        let end = slice.find('<').unwrap_or(slice.len().min(280));
        let raw = strip_tags(&slice[..end]);
        if raw.to_ascii_uppercase().contains(&want) {
            return Ok(ParsedTaf {
                raw,
                header_issued_at: header,
            });
        }
    }
    Err(ParseFailure::NoTaf)
}

fn extract_bulletin_line(html: &str, kind: &str, icao: &str) -> Option<String> {
    let needle = format!("{kind} {icao} ");
    let idx = html.to_ascii_uppercase().find(&needle.to_ascii_uppercase())?;
    let raw = &html[idx..];
    let end = raw.find('<').unwrap_or(raw.len().min(280));
    let line = raw[..end].trim();
    if line.starts_with(kind) && line.len() > kind.len() + 5 {
        Some(line.to_string())
    } else {
        None
    }
}

fn strip_taf_prefix(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("TAF:")
        .trim()
        .to_string()
}

fn extract_codification_lines(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let needle = "codificacion";
    let mut rest = html;
    while let Some(idx) = rest.find(needle) {
        let after = &rest[idx + needle.len()..];
        let close = after.find("</div>").unwrap_or(after.len());
        let chunk = &after[..close];
        let text = strip_tags(chunk);
        if !text.is_empty() {
            out.push(text);
        }
        rest = &after[close.min(after.len())..];
    }
    out
}

fn strip_tags(chunk: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for ch in chunk.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `METAR del 18-11-2026 a las 13:00 UTC` or `TAF del 18/11/2026 a las 10:00 UTC`
fn parse_spanish_header(html: &str, prefix: &str, sep: char) -> Option<UtcStamp> {
    let idx = html.find(prefix)?;
    let slice = &html[idx + prefix.len()..];
    let digits: String = slice
        .chars()
        .take(32)
        .filter(|ch| ch.is_ascii_digit() || *ch == sep || *ch == ' ')
        .collect();
    let parts: Vec<&str> = digits.split_whitespace().collect();
    let date = parts.first()?;
    let date_parts: Vec<&str> = date.split(sep).collect();
    if date_parts.len() != 3 {
        return None;
    }
    let day: i32 = date_parts[0].parse().ok()?;
    let month: i32 = date_parts[1].parse().ok()?;
    let year: i32 = date_parts[2].parse().ok()?;
    let time_idx = slice.find("a las ")? + 6;
    let time_slice = &slice[time_idx..];
    let hour: i32 = time_slice.get(0..2)?.parse().ok()?;
    let minute: i32 = time_slice.get(3..5)?.parse().ok()?;
    parse_utc_iso(&format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:00Z"
    ))
    .ok()
}

pub fn issue_from_metar_raw(raw: &str, now: UtcStamp) -> Option<UtcStamp> {
    let token = raw.split_whitespace().nth(2)?;
    if token.len() != 7 || !token.ends_with('Z') {
        return None;
    }
    let day: i32 = token[0..2].parse().ok()?;
    let hour: i32 = token[2..4].parse().ok()?;
    let minute: i32 = token[4..6].parse().ok()?;
    let parts = now.parts();
    let mut month = parts.month0 + 1;
    let mut year = parts.year;
    if day > parts.day as i32 + 20 {
        month -= 1;
        if month < 1 {
            month = 12;
            year -= 1;
        }
    } else if day + 20 < parts.day as i32 {
        month += 1;
        if month > 12 {
            month = 1;
            year += 1;
        }
    }
    parse_utc_iso(&format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:00Z")).ok()
}

pub fn resolved_issue(
    header: Option<UtcStamp>,
    raw: &str,
    now: UtcStamp,
) -> Option<UtcStamp> {
    header.or_else(|| issue_from_metar_raw(raw, now))
}

pub fn age_seconds(now: UtcStamp, issued: UtcStamp) -> i64 {
    (now.epoch_ms() - issued.epoch_ms()) / 1000
}

pub fn stale_metar(age_secs: i64) -> bool {
    age_secs > METAR_STALE_SECS
}

pub fn stale_taf(age_secs: i64) -> bool {
    age_secs > TAF_STALE_SECS
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn read_fixture(name: &str) -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/official")
            .join(name);
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn parse_sctb_metar_fixture() {
        let html = read_fixture("metar-sctb.html");
        let parsed = parse_metar_html(&html, "SCTB").expect("metar");
        assert!(parsed.raw.starts_with("METAR SCTB"));
        assert_eq!(parsed.kind, "METAR");
        assert!(parsed.header_issued_at.is_some());
    }

    #[test]
    fn parse_scvh_no_taf_fixture() {
        let html = read_fixture("taf-scvh-none.html");
        assert_eq!(
            parse_taf_html(&html, "SCVH"),
            Err(ParseFailure::NoTafForDesignator)
        );
    }

    #[test]
    fn parse_sctb_taf_fixture() {
        let html = read_fixture("taf-sctb.html");
        let parsed = parse_taf_html(&html, "SCTB").expect("taf");
        assert!(parsed.raw.starts_with("TAF SCTB"));
    }

    #[test]
    fn stale_thresholds() {
        assert!(!stale_metar(3599));
        assert!(stale_metar(3601));
        assert!(!stale_taf(6 * 3600));
        assert!(stale_taf(6 * 3600 + 1));
    }

    #[test]
    fn allowed_icao_includes_andes_extras() {
        assert!(allowed_icao("SCVH"));
        assert!(allowed_icao("SCIL"));
        assert!(!allowed_icao("KORD"));
    }
}