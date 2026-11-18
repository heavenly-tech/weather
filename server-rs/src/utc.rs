//! UTC timestamps with `Date.UTC` overflow, and no local timezone.
//!
//! Open-Meteo stamps are `YYYY-MM-DDTHH:mm` without a zone. The TypeScript
//! parser appends `Z`. Midnight and hour 24 are exact millisecond offsets.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UtcStamp {
    ms: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UtcParts {
    pub year: i32,
    pub month0: i32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    pub millis: u32,
}

impl UtcStamp {
    pub fn from_epoch_ms(ms: i64) -> Self {
        Self { ms }
    }

    pub fn epoch_ms(self) -> i64 {
        self.ms
    }

    /// `Date.prototype.toISOString`, always with milliseconds.
    pub fn to_iso(self) -> String {
        let parts = self.parts();
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
            parts.year,
            parts.month0 + 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second,
            parts.millis
        )
    }

    pub fn parts(self) -> UtcParts {
        let days = self.ms.div_euclid(86_400_000);
        let tod = self.ms.rem_euclid(86_400_000) as u32;
        let (year, month, day) = civil_from_days(days);
        UtcParts {
            year,
            month0: month as i32 - 1,
            day,
            hour: tod / 3_600_000,
            minute: (tod % 3_600_000) / 60_000,
            second: (tod % 60_000) / 1000,
            millis: tod % 1000,
        }
    }

    pub fn from_parts(
        year: i32,
        month0: i32,
        day: i32,
        hour: i32,
        minute: i32,
        second: i32,
        millis: i32,
    ) -> Self {
        Self {
            ms: js_date_utc(year, month0, day, hour, minute, second, millis),
        }
    }

    pub fn plus_hours(self, hours: i32) -> Self {
        let parts = self.parts();
        Self::from_parts(
            parts.year,
            parts.month0,
            parts.day as i32,
            parts.hour as i32 + hours,
            parts.minute as i32,
            parts.second as i32,
            parts.millis as i32,
        )
    }
}

/// `parseUtcIso`: a trailing `Z` is UTC, and a zone-less stamp is UTC too.
pub fn parse_utc_iso(iso: &str) -> Result<UtcStamp, String> {
    let iso = iso.trim();
    let core = iso.strip_suffix('Z').unwrap_or(iso);
    if has_numeric_offset(core) {
        return Err(format!("offset timestamps are not used: {iso}"));
    }
    let bytes = core.as_bytes();
    if bytes.len() < 16
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
    {
        return Err(format!("bad utc timestamp: {iso}"));
    }
    let year = parse_i32(&core[0..4], iso)?;
    let month = parse_i32(&core[5..7], iso)?;
    let day = parse_i32(&core[8..10], iso)?;
    let hour = parse_i32(&core[11..13], iso)?;
    let minute = parse_i32(&core[14..16], iso)?;
    let (second, millis) = if bytes.len() == 16 {
        (0, 0)
    } else if bytes.len() >= 19 && bytes[16] == b':' {
        let second = parse_i32(&core[17..19], iso)?;
        let millis = if bytes.len() > 19 {
            if bytes[19] != b'.' {
                return Err(format!("bad utc timestamp: {iso}"));
            }
            parse_millis(&core[20..], iso)?
        } else {
            0
        };
        (second, millis)
    } else {
        return Err(format!("bad utc timestamp: {iso}"));
    };
    Ok(UtcStamp::from_parts(
        year,
        month - 1,
        day,
        hour,
        minute,
        second,
        millis,
    ))
}

fn has_numeric_offset(core: &str) -> bool {
    let bytes = core.as_bytes();
    if bytes.len() < 6 {
        return false;
    }
    let tail = &bytes[bytes.len() - 6..];
    (tail[0] == b'+' || tail[0] == b'-') && tail[3] == b':'
}

fn parse_i32(text: &str, iso: &str) -> Result<i32, String> {
    text.parse()
        .map_err(|_| format!("bad utc timestamp: {iso}"))
}

fn parse_millis(text: &str, iso: &str) -> Result<i32, String> {
    if text.is_empty() || text.len() > 3 || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("bad utc timestamp: {iso}"));
    }
    let mut padded = text.to_string();
    while padded.len() < 3 {
        padded.push('0');
    }
    parse_i32(&padded, iso)
}

/// `Date.UTC`, including hour 24 and day 0.
pub fn js_date_utc(
    year: i32,
    month_index: i32,
    day: i32,
    hour: i32,
    minute: i32,
    second: i32,
    millis: i32,
) -> i64 {
    let mut year = i64::from(year);
    let mut month = i64::from(month_index);
    let carry = month.div_euclid(12);
    year += carry;
    month = month.rem_euclid(12);
    let base = days_from_civil(year as i32, month as u32 + 1, 1);
    let day_index = base + i64::from(day) - 1;
    day_index * 86_400_000
        + i64::from(hour) * 3_600_000
        + i64::from(minute) * 60_000
        + i64::from(second) * 1_000
        + i64::from(millis)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let yoe = (year - era * 400) as u64;
    let month_adj = i64::from(month) + if month > 2 { -3 } else { 9 };
    let doy = (153 * month_adj + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy as u64;
    era * 146097 + doe as i64 - 719468
}

fn civil_from_days(mut z: i64) -> (i32, u32, u32) {
    z += 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    (year as i32, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_epoch_and_sctb_night_stamp() {
        assert_eq!(js_date_utc(1970, 0, 1, 0, 0, 0, 0), 0);
        let stamp = parse_utc_iso("2026-11-17T05:00").unwrap();
        let parts = stamp.parts();
        assert_eq!(parts.year, 2026);
        assert_eq!(parts.month0, 10);
        assert_eq!(parts.day, 17);
        assert_eq!(parts.hour, 5);
        assert_eq!(stamp.epoch_ms(), js_date_utc(2026, 10, 17, 5, 0, 0, 0));
    }

    #[test]
    fn hour_24_is_the_next_midnight_and_day_zero_is_the_previous_month() {
        assert_eq!(
            js_date_utc(2026, 10, 18, 24, 0, 0, 0),
            js_date_utc(2026, 10, 19, 0, 0, 0, 0)
        );
        let previous = UtcStamp::from_parts(2026, 10, 0, 0, 0, 0, 0);
        assert_eq!(previous.parts().day, 31);
        assert_eq!(previous.parts().month0, 9);
    }
}
