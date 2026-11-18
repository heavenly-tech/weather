//! DGAC IFIS (aipchile.dgac.gob.cl) HTML fetch URLs and parsing.

use crate::utc::{parse_utc_iso, UtcStamp};

pub const DGAC_USER_AGENT: &str = "heavenly-weather/0.1 (server-side dgac-ifis cache)";
pub const SOURCE: &str = "dgac-ifis";
pub const OFFICIAL_LABEL: &str = "Oficial DGAC";

pub const METAR_TTL_MS: i64 = 5 * 60 * 1000;
pub const TAF_TTL_MS: i64 = 30 * 60 * 1000;
/// METAR/SPECI older than this is marked stale (see docs/official-data/dgac-aip-chile.md).
pub const METAR_STALE_SECS: i64 = 75 * 60;
/// When validity cannot be parsed, fall back to issue age (generous).
pub const TAF_ISSUE_AGE_FALLBACK_SECS: i64 = 30 * 60 * 60;
/// After validity ends, allow this long before marking stale if the bulletin is still the latest we have.
pub const TAF_POST_VALIDITY_GRACE_SECS: i64 = 3 * 60 * 60;

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
    let header = parse_spanish_header(html, "METAR del ", '-')
        .or_else(|| parse_spanish_header(html, "SPECI del ", '-'));
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
    let idx = html
        .to_ascii_uppercase()
        .find(&needle.to_ascii_uppercase())?;
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
    raw.trim().trim_start_matches("TAF:").trim().to_string()
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
    parse_utc_iso(&format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:00Z"
    ))
    .ok()
}

pub fn resolved_issue(header: Option<UtcStamp>, raw: &str, now: UtcStamp) -> Option<UtcStamp> {
    header.or_else(|| issue_from_metar_raw(raw, now))
}

pub fn age_seconds(now: UtcStamp, issued: UtcStamp) -> i64 {
    (now.epoch_ms() - issued.epoch_ms()) / 1000
}

pub fn stale_metar(age_secs: i64) -> bool {
    age_secs > METAR_STALE_SECS
}

/// TAF is current while `now` is inside the bulletin validity window; after `validTo` we wait a
/// short grace before marking stale (next issue may be slightly late). Issue age alone does not expire
/// an in-window TAF.
pub fn stale_taf(raw: &str, now: UtcStamp, issued: Option<UtcStamp>) -> bool {
    let issued = match issued.or_else(|| issue_from_metar_raw(raw, now)) {
        Some(stamp) => stamp,
        None => return true,
    };
    match taf_validity_window(raw, issued) {
        Some((valid_from, valid_to)) => {
            let now_ms = now.epoch_ms();
            if now_ms < valid_from.epoch_ms() {
                return false;
            }
            if now_ms > valid_to.epoch_ms() {
                let overdue_secs = (now_ms - valid_to.epoch_ms()) / 1000;
                return overdue_secs > TAF_POST_VALIDITY_GRACE_SECS;
            }
            false
        }
        None => age_seconds(now, issued) > TAF_ISSUE_AGE_FALLBACK_SECS,
    }
}

/// Parse `DDHH/DDHH` from a TAF body using the issue time as month/year anchor.
pub fn taf_validity_window(raw: &str, issue: UtcStamp) -> Option<(UtcStamp, UtcStamp)> {
    let body = raw.trim().trim_start_matches("TAF:").trim();
    let mut tokens = body.split_whitespace();
    if tokens.next()? != "TAF" {
        return None;
    }
    let icao = tokens.next()?;
    if icao.len() != 4 {
        return None;
    }
    let issue_token = tokens.next()?;
    if !issue_token.ends_with('Z') || issue_token.len() != 7 {
        return None;
    }
    let validity = tokens.next()?;
    let (from_str, to_str) = validity.split_once('/')?;
    if from_str.len() != 4 || to_str.len() != 4 {
        return None;
    }
    let valid_from = ddhh_to_stamp(from_str, issue, false)?;
    let valid_to = ddhh_to_stamp(to_str, issue, true)?;
    Some((valid_from, valid_to))
}

fn ddhh_to_stamp(ddhh: &str, anchor: UtcStamp, as_validity_end: bool) -> Option<UtcStamp> {
    let day: i32 = ddhh[..2].parse().ok()?;
    let hour: i32 = ddhh[2..4].parse().ok()?;
    let parts = anchor.parts();
    if as_validity_end && hour == 24 {
        return Some(UtcStamp::from_parts(
            parts.year,
            parts.month0,
            day + 1,
            0,
            0,
            0,
            0,
        ));
    }
    let mut stamp = UtcStamp::from_parts(parts.year, parts.month0, day, hour, 0, 0, 0);
    if stamp.epoch_ms() < anchor.epoch_ms() - 20 * 86_400_000 {
        stamp = UtcStamp::from_parts(parts.year, parts.month0 + 1, day, hour, 0, 0, 0);
    }
    Some(stamp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utc::parse_utc_iso;
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
    fn stale_metar_threshold() {
        assert!(!stale_metar(METAR_STALE_SECS));
        assert!(stale_metar(METAR_STALE_SECS + 1));
    }

    #[test]
    fn stale_taf_validity_window() {
        let raw = "TAF SCTB 181100Z 1812/1824 VRB02KT 9999 NSC";
        let issue = parse_utc_iso("2026-11-18T11:00:00Z").unwrap();
        let during = parse_utc_iso("2026-11-18T13:05:00Z").unwrap();
        assert!(
            !stale_taf(raw, during, Some(issue)),
            "in-window TAF stays current despite issue age"
        );
        let expired = parse_utc_iso("2026-11-19T04:00:00Z").unwrap();
        assert!(
            stale_taf(raw, expired, Some(issue)),
            "past validity end (+ grace) is stale"
        );
    }

    #[test]
    fn taf_validity_parses_dd24_end() {
        let raw = "TAF SCTB 181100Z 1812/1824 VRB02KT 9999 NSC";
        let issue = parse_utc_iso("2026-11-18T11:00:00Z").unwrap();
        let (_, end) = taf_validity_window(raw, issue).unwrap();
        assert_eq!(end.to_iso(), "2026-11-19T00:00:00.000Z");
    }

    #[test]
    fn allowed_icao_includes_andes_extras() {
        assert!(allowed_icao("SCVH"));
        assert!(allowed_icao("SCIL"));
        assert!(!allowed_icao("KORD"));
    }
}
