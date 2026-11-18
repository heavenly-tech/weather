//! Hourly model series: numeric columns plus the UTC `time` strings.
//!
//! `Hourly` drops non-numeric cells. TAF windows need the original stamps,
//! including a missing `time` array (length 0, same as `hourly.time?.length`).

use crate::ceiling::{num_at, Hourly};
use serde_json::Value;

#[derive(Clone, Debug)]
pub struct Series {
    pub hourly: Hourly,
    pub time: Vec<String>,
}

impl Series {
    pub fn from_json(value: &Value) -> Self {
        let time = value
            .get("time")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|item| item.as_str().unwrap_or("").to_string())
                    .collect()
            })
            .unwrap_or_default();
        Self {
            hourly: Hourly::from_json(value),
            time,
        }
    }

    pub fn num(&self, key: &str, index: usize) -> Option<f64> {
        num_at(&self.hourly, key, index)
    }

    pub fn time_len(&self) -> usize {
        self.time.len()
    }
}
