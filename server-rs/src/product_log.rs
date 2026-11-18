//! Generated-product log. Appends only when `PRODUCT_LOG_ENABLED=1`.
//! The id is `Date.now().toString(36)` plus six characters of `Math.random().toString(36)`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::cache::Clock;
use crate::js_json::Js;

pub struct ProductLog {
    clock: Clock,
    recent: Mutex<HashMap<String, i64>>,
}

impl ProductLog {
    pub fn new(clock: Clock) -> Self {
        Self {
            clock,
            recent: Mutex::new(HashMap::new()),
        }
    }

    pub async fn append(&self, entry: &LogEntry) {
        if std::env::var("PRODUCT_LOG_ENABLED").ok().as_deref() != Some("1") {
            return;
        }
        let key = format!(
            "{}:{}:{}:{}",
            entry.kind, entry.icao, entry.valid_time, entry.model
        );
        let now = self.clock.now_ms();
        {
            let mut recent = self.recent.lock().await;
            if let Some(last) = recent.get(&key) {
                if now - *last < 60 * 60 * 1000 {
                    return;
                }
            }
            recent.insert(key, now);
        }
        let path = std::env::var("PRODUCT_LOG_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/product-log.jsonl"));
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let line = format!("{}\n", entry.json());
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut file| {
                use std::io::Write;
                file.write_all(line.as_bytes())
            });
        let max = std::env::var("PRODUCT_LOG_MAX_LINES")
            .ok()
            .and_then(|text| text.parse::<usize>().ok())
            .unwrap_or(2000);
        if let Ok(text) = std::fs::read_to_string(&path) {
            let lines: Vec<&str> = text.lines().filter(|line| !line.is_empty()).collect();
            if lines.len() > max {
                let kept = lines[lines.len() - max..].join("\n");
                let _ = std::fs::write(&path, format!("{kept}\n"));
            }
        }
    }
}

pub struct LogEntry {
    pub id: String,
    pub kind: &'static str,
    pub model: String,
    pub run_time: String,
    pub valid_time: String,
    pub lat: f64,
    pub lon: f64,
    pub icao: String,
    pub raw: String,
    pub created_at: String,
}

impl LogEntry {
    fn json(&self) -> String {
        let point = Js::Obj(vec![
            ("lat", Js::Num(self.lat)),
            ("lon", Js::Num(self.lon)),
            ("icao", Js::Str(&self.icao)),
        ]);
        let bytes = Js::Obj(vec![
            ("id", Js::Str(&self.id)),
            ("kind", Js::Str(self.kind)),
            ("model", Js::Str(&self.model)),
            ("runTime", Js::Str(&self.run_time)),
            ("validTime", Js::Str(&self.valid_time)),
            ("point", point),
            ("raw", Js::Str(&self.raw)),
            ("createdAt", Js::Str(&self.created_at)),
        ])
        .to_bytes();
        String::from_utf8(bytes).unwrap_or_default()
    }
}

pub fn new_log_id(now_ms: i64, random: f64) -> String {
    let rendered = js_to_string_36(random);
    let sliced: String = rendered.chars().skip(2).take(6).collect();
    format!("{}-{sliced}", js_to_string_36(now_ms as f64))
}

fn js_to_string_36(value: f64) -> String {
    if value == 0.0 {
        return "0".to_string();
    }
    if value.fract() == 0.0 && value.abs() < i64::MAX as f64 {
        return base36_int(value as i64);
    }
    let whole = value.trunc();
    let mut frac = (value - whole).abs();
    let mut digits = String::new();
    for _ in 0..16 {
        frac *= 36.0;
        let digit = frac.floor();
        digits.push(base36_digit(digit as u32));
        frac -= digit;
        if frac == 0.0 {
            break;
        }
    }
    format!("{}.{}", base36_int(whole as i64), digits)
}

fn base36_int(mut value: i64) -> String {
    if value == 0 {
        return "0".to_string();
    }
    let negative = value < 0;
    if negative {
        value = value.saturating_abs();
    }
    let mut bytes = Vec::new();
    while value > 0 {
        bytes.push(base36_digit((value % 36) as u32) as u8);
        value /= 36;
    }
    if negative {
        bytes.push(b'-');
    }
    bytes.reverse();
    String::from_utf8(bytes).unwrap_or_else(|_| "0".to_string())
}

fn base36_digit(digit: u32) -> char {
    char::from(if digit < 10 {
        b'0' + digit as u8
    } else {
        b'a' + (digit as u8 - 10)
    })
}

pub fn rng_half() -> Arc<dyn Fn() -> f64 + Send + Sync> {
    Arc::new(|| 0.5)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_id_matches_math_random_one_half() {
        assert_eq!(new_log_id(1_794_891_600_000, 0.5), "mwk84680-i");
    }
}
