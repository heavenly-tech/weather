//! `GET /api/health`. The body is serde's compact encoding of the same object
//! the TypeScript route returns. Byte equality is checked against the fixture
//! captured from that route.

use axum::http::{header, StatusCode};
use axum::response::IntoResponse;
use serde::Serialize;

pub const SERVICE: &str = "heavenly-weather";

#[derive(Serialize)]
struct HealthBody {
    ok: bool,
    service: &'static str,
}

pub fn body_bytes() -> Vec<u8> {
    serde_json::to_vec(&HealthBody {
        ok: true,
        service: SERVICE,
    })
    .expect("health json is a static object")
}

pub async fn get() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        body_bytes(),
    )
}

/// HTTP 200 and a JSON object with `"ok": true`. Anything else is unhealthy.
pub fn body_is_ok(bytes: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(bytes)
        .ok()
        .and_then(|value| value.get("ok").and_then(serde_json::Value::as_bool))
        == Some(true)
}

pub async fn probe(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");
    let client = match crate::client::build() {
        Ok(client) => client,
        Err(err) => {
            eprintln!("healthcheck: client: {err}");
            return false;
        }
    };
    let response = match client.get(&url).send().await {
        Ok(response) => response,
        Err(err) => {
            eprintln!("healthcheck: GET {url}: {err}");
            return false;
        }
    };
    if response.status() != reqwest::StatusCode::OK {
        eprintln!("healthcheck: GET {url}: HTTP {}", response.status());
        return false;
    }
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("healthcheck: GET {url}: {err}");
            return false;
        }
    };
    if body_is_ok(&bytes) {
        true
    } else {
        eprintln!("healthcheck: GET {url}: body is not ok");
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_body_is_healthy() {
        assert!(body_is_ok(br#"{"ok":true,"service":"heavenly-weather"}"#));
        assert!(body_is_ok(br#"{"service":"other","ok":true}"#));
    }

    #[test]
    fn unhealthy_bodies() {
        assert!(!body_is_ok(b""));
        assert!(!body_is_ok(b"not json"));
        assert!(!body_is_ok(br#"{"ok":false}"#));
        assert!(!body_is_ok(br#"{"ok":"true"}"#));
        assert!(!body_is_ok(br#"{"service":"heavenly-weather"}"#));
    }
}
