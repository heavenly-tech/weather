//! `assertModelTafFormat`.
//!
//! Hour 00 as an end is rejected. Midnight is DD24 of the previous day.
//! A BECMG longer than 4 h fails; longer than 2 h warns. The day anchor is
//! January 2026 of the issue day, matching the TypeScript validator.

use crate::js_json::format_js_number;
use crate::utc::{parse_utc_iso, UtcStamp};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TafFormat {
    Pass {
        warnings: Vec<String>,
    },
    Fail {
        reasons: Vec<String>,
        warnings: Vec<String>,
    },
}

impl TafFormat {
    pub fn ok(&self) -> bool {
        matches!(self, Self::Pass { .. })
    }

    pub fn warnings(&self) -> &[String] {
        match self {
            Self::Pass { warnings } | Self::Fail { warnings, .. } => warnings,
        }
    }

    pub fn reasons(&self) -> &[String] {
        match self {
            Self::Pass { .. } => &[],
            Self::Fail { reasons, .. } => reasons,
        }
    }
}

struct GroupHit {
    tag: String,
    from: String,
    to: Option<String>,
}

pub fn assert_model_taf_format(raw: &str) -> TafFormat {
    let mut reasons = Vec::new();
    let mut warnings = Vec::new();
    if !raw.starts_with(crate::metar::STAMP) {
        reasons.push("stamp must be first line".to_string());
    }
    let body = raw.split('\n').skip(1).collect::<Vec<_>>().join(" ");
    let body = body.trim();
    let header = parse_header(body);
    if header.is_none() {
        reasons.push("TAF header / validity (DDHHMMZ issue; DDHH/DDHH validity)".to_string());
    }
    let anchor = header.as_ref().map(|header| issue_anchor(&header.issue));
    if let Some(header) = &header {
        if end_hour(&header.valid_to) == 0 {
            reasons.push(format!(
                "validity end {}/{} codes midnight as 00; write hour 24 on the previous day",
                header.valid_from, header.valid_to
            ));
        }
    }

    for group in change_groups(body) {
        let to_group = group.to.clone().unwrap_or_else(|| group.from.clone());
        if (group.tag == "BECMG" || group.tag == "TEMPO" || group.tag.starts_with("PROB"))
            && group.to.is_none()
        {
            reasons.push(format!("{} must use DDhh/DDhh window", group.tag));
        }
        if group.to.is_some() && group.from == to_group {
            reasons.push(format!(
                "{} zero-length window {}/{}",
                group.tag, group.from, to_group
            ));
        }
        if group.to.is_some() && end_hour(&to_group) == 0 {
            reasons.push(format!(
                "{} {}/{} codes midnight as 00; write hour 24 on the previous day",
                group.tag, group.from, to_group
            ));
        }
        if let (Some(header), Some(anchor)) = (&header, anchor) {
            let valid_from = ddhh_to_ms(&header.valid_from, anchor);
            let valid_to = ddhh_to_ms(&header.valid_to, anchor);
            let group_from = ddhh_to_ms(&group.from, anchor);
            let group_to = ddhh_to_ms(&to_group, anchor);
            if group_from < valid_from || group_to > valid_to {
                reasons.push(format!(
                    "change group {} {}/{} outside validity {}/{}",
                    group.tag, group.from, to_group, header.valid_from, header.valid_to
                ));
            }
        }
        if group.tag == "BECMG" && group.to.is_some() {
            if let Some(anchor) = anchor {
                let hours = (ddhh_to_ms(&to_group, anchor) - ddhh_to_ms(&group.from, anchor))
                    as f64
                    / 3_600_000.0;
                let hours_text = format_js_number(hours);
                if hours > 4.0 {
                    reasons.push(format!(
                        "BECMG {}/{} is {hours_text} h (never over 4 h)",
                        group.from, to_group
                    ));
                } else if hours > 2.0 {
                    warnings.push(format!(
                        "BECMG {}/{} is {hours_text} h (normally 2 h or less)",
                        group.from, to_group
                    ));
                }
            }
        }
    }

    let becmg_count = count_word(body, "BECMG");
    if becmg_count > 6 {
        reasons.push(format!("too many BECMG groups ({becmg_count})"));
    }
    if reasons.is_empty() {
        TafFormat::Pass { warnings }
    } else {
        TafFormat::Fail { reasons, warnings }
    }
}

struct Header {
    issue: String,
    valid_from: String,
    valid_to: String,
}

fn parse_header(body: &str) -> Option<Header> {
    let rest = body.strip_prefix("TAF")?;
    if rest
        .as_bytes()
        .first()
        .is_none_or(|byte| !byte.is_ascii_whitespace())
    {
        return None;
    }
    let mut tokens = body.split_whitespace();
    if tokens.next() != Some("TAF") {
        return None;
    }
    let icao = tokens.next()?;
    if icao.len() != 4 || !icao.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return None;
    }
    let issue = tokens.next()?;
    let issue_digits = issue.strip_suffix('Z')?;
    if issue_digits.len() != 6 || !issue_digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let validity = tokens.next()?;
    let (valid_from, valid_to) = validity.split_once('/')?;
    if !is_ddhh(valid_from) || !is_ddhh(valid_to) {
        return None;
    }
    Some(Header {
        issue: issue_digits.to_string(),
        valid_from: valid_from.to_string(),
        valid_to: valid_to.to_string(),
    })
}

fn is_ddhh(text: &str) -> bool {
    text.len() == 4 && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn end_hour(ddhh: &str) -> u32 {
    ddhh[2..4].parse().unwrap_or(0)
}

fn issue_anchor(issue: &str) -> UtcStamp {
    let day = &issue[..2];
    let hour = &issue[2..4];
    parse_utc_iso(&format!("2026-01-{day}T{hour}:00:00Z"))
        .unwrap_or_else(|_| UtcStamp::from_parts(2026, 0, 1, 0, 0, 0, 0))
}

fn ddhh_to_ms(ddhh: &str, anchor: UtcStamp) -> i64 {
    let day: i32 = ddhh[..2].parse().unwrap_or(0);
    let hour: i32 = ddhh[2..4].parse().unwrap_or(0);
    let parts = anchor.parts();
    let mut stamp = UtcStamp::from_parts(parts.year, parts.month0, day, hour, 0, 0, 0);
    if stamp.epoch_ms() < anchor.epoch_ms() - 20 * 86_400_000 {
        stamp = UtcStamp::from_parts(parts.year, parts.month0 + 1, day, hour, 0, 0, 0);
    }
    stamp.epoch_ms()
}

fn is_word(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn change_groups(body: &str) -> Vec<GroupHit> {
    let tags = ["BECMG", "TEMPO", "PROB30", "PROB40"];
    let bytes = body.as_bytes();
    let mut index = 0;
    let mut hits = Vec::new();
    while index < bytes.len() {
        let boundary = index == 0 || !is_word(bytes[index - 1]);
        if !boundary {
            index += 1;
            continue;
        }
        let mut found = None;
        for tag in tags {
            let tag_bytes = tag.as_bytes();
            let after = index + tag_bytes.len();
            if bytes[index..].starts_with(tag_bytes)
                && (after == bytes.len() || !is_word(bytes[after]))
            {
                found = Some((tag, after));
                break;
            }
        }
        let Some((tag, after)) = found else {
            index += 1;
            continue;
        };
        if after >= bytes.len() || !bytes[after].is_ascii_whitespace() {
            index += 1;
            continue;
        }
        let mut cursor = after;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor + 4 > bytes.len()
            || !bytes[cursor..cursor + 4]
                .iter()
                .all(|byte| byte.is_ascii_digit())
        {
            index += 1;
            continue;
        }
        let from = body[cursor..cursor + 4].to_string();
        cursor += 4;
        let to = if cursor < bytes.len()
            && bytes[cursor] == b'/'
            && cursor + 5 <= bytes.len()
            && bytes[cursor + 1..cursor + 5]
                .iter()
                .all(|byte| byte.is_ascii_digit())
        {
            let to = body[cursor + 1..cursor + 5].to_string();
            cursor += 5;
            Some(to)
        } else {
            None
        };
        hits.push(GroupHit {
            tag: tag.to_string(),
            from,
            to,
        });
        index = cursor;
    }
    hits
}

fn count_word(text: &str, word: &str) -> usize {
    let bytes = text.as_bytes();
    let needle = word.as_bytes();
    let mut count = 0;
    let mut index = 0;
    while index + needle.len() <= bytes.len() {
        let start_ok = index == 0 || !is_word(bytes[index - 1]);
        let end = index + needle.len();
        let end_ok = end == bytes.len() || !is_word(bytes[end]);
        if start_ok && end_ok && &bytes[index..end] == needle {
            count += 1;
            index = end;
            continue;
        }
        index += 1;
    }
    count
}
