//! In-memory Open-Meteo cache.
//!
//! The key is the exact URL. GFS and ICON live 3 h, ECMWF and GEM 6 h,
//! elevation 30 d, and anything else 15 min. Identical in-flight URLs share
//! one fetch and each waiter gets its own body. Only HTTP 200 is stored. A
//! 429 is handed to every waiter and then dropped, so the batch retry is a
//! new network call.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{watch, Mutex};

use crate::models::cache_ttl_ms;

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

#[derive(Clone, Debug)]
pub struct UpstreamResponse {
    pub status: u16,
    pub body: String,
    pub status_text: String,
}

pub type FetchFn = Arc<dyn Fn(String) -> BoxFuture<Result<UpstreamResponse, String>> + Send + Sync>;
pub type SleepFn = Arc<dyn Fn(u64) -> BoxFuture<()> + Send + Sync>;

#[derive(Clone)]
pub struct Clock {
    now_ms: Arc<dyn Fn() -> i64 + Send + Sync>,
}

impl Clock {
    pub fn system() -> Self {
        Self {
            now_ms: Arc::new(|| {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_millis() as i64)
                    .unwrap_or(0)
            }),
        }
    }

    pub fn at(ms: i64) -> Self {
        Self {
            now_ms: Arc::new(move || ms),
        }
    }

    pub fn from_fn(now_ms: Arc<dyn Fn() -> i64 + Send + Sync>) -> Self {
        Self { now_ms }
    }

    pub fn now_ms(&self) -> i64 {
        (self.now_ms)()
    }

    pub fn now_iso(&self) -> String {
        crate::utc::UtcStamp::from_epoch_ms(self.now_ms()).to_iso()
    }
}

#[derive(Clone, Debug)]
pub struct CachedResponse {
    pub status: u16,
    pub body: String,
    pub status_text: String,
    pub cache: Option<&'static str>,
}

struct Entry {
    body: String,
    expires_at: i64,
}

struct Flight {
    /// Kept so the watch channel stays open until the flight is removed.
    #[allow(dead_code)]
    tx: watch::Sender<Option<Result<CachedResponse, String>>>,
    rx: watch::Receiver<Option<Result<CachedResponse, String>>>,
}

struct State {
    store: HashMap<String, Entry>,
    inflight: HashMap<String, Flight>,
}

pub struct OpenMeteoCache {
    state: Mutex<State>,
    fetch: FetchFn,
    pub clock: Clock,
    pub sleep: SleepFn,
}

impl OpenMeteoCache {
    pub fn new(fetch: FetchFn, clock: Clock, sleep: SleepFn) -> Self {
        Self {
            state: Mutex::new(State {
                store: HashMap::new(),
                inflight: HashMap::new(),
            }),
            fetch,
            clock,
            sleep,
        }
    }

    pub fn production() -> reqwest::Result<Self> {
        let client = crate::client::open_meteo()?;
        let fetch: FetchFn = Arc::new(move |url: String| {
            let client = client.clone();
            Box::pin(async move { free_tier_fetch(&client, &url).await })
        });
        Ok(Self::new(fetch, Clock::system(), tokio_sleep()))
    }

    pub fn clear(&self) {
        if let Ok(mut state) = self.state.try_lock() {
            state.store.clear();
            state.inflight.clear();
        }
    }

    pub async fn cached_fetch(
        &self,
        url: &str,
        model_hint: Option<&str>,
    ) -> Result<CachedResponse, String> {
        reject_paid_url(url)?;
        let now = self.clock.now_ms();
        let mut state = self.state.lock().await;
        if let Some(hit) = state.store.get(url) {
            if hit.expires_at > now {
                return Ok(CachedResponse {
                    status: 200,
                    body: hit.body.clone(),
                    status_text: "OK".to_string(),
                    cache: Some("hit"),
                });
            }
        }
        if let Some(flight) = state.inflight.get(url) {
            let mut rx = flight.rx.clone();
            drop(state);
            if rx.borrow().is_none() {
                rx.changed()
                    .await
                    .map_err(|_| "in-flight fetch dropped".to_string())?;
            }
            return rx
                .borrow()
                .clone()
                .ok_or_else(|| "in-flight fetch dropped".to_string())?;
        }

        let (tx, rx) = watch::channel(None);
        state
            .inflight
            .insert(url.to_string(), Flight { tx: tx.clone(), rx });
        drop(state);

        let fetched = (self.fetch)(url.to_string()).await;
        let outcome = match fetched {
            Ok(response) if response.status == 200 => {
                let ttl = cache_ttl_ms(model_hint.unwrap_or(&model_from_url(url)));
                let mut state = self.state.lock().await;
                state.store.insert(
                    url.to_string(),
                    Entry {
                        body: response.body.clone(),
                        expires_at: self.clock.now_ms() + ttl,
                    },
                );
                Ok(CachedResponse {
                    status: 200,
                    body: response.body,
                    status_text: response.status_text,
                    cache: Some("miss"),
                })
            }
            Ok(response) => Ok(CachedResponse {
                status: response.status,
                body: response.body,
                status_text: response.status_text,
                cache: None,
            }),
            Err(error) => Err(error),
        };
        let _ = tx.send(Some(outcome.clone()));
        self.state.lock().await.inflight.remove(url);
        outcome
    }
}

pub fn tokio_sleep() -> SleepFn {
    Arc::new(|ms| Box::pin(async move { tokio::time::sleep(Duration::from_millis(ms)).await }))
}

pub fn batch_size() -> usize {
    std::env::var("OPEN_METEO_BATCH_SIZE")
        .ok()
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value >= 1.0)
        .map(|value| value as usize)
        .unwrap_or(60)
}

pub fn batch_delay_ms() -> u64 {
    std::env::var("OPEN_METEO_BATCH_DELAY_MS")
        .ok()
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| value as u64)
        .unwrap_or(250)
}

fn model_from_url(url: &str) -> String {
    query_param(url, "models").unwrap_or_else(|| "default".to_string())
}

fn query_param(url: &str, name: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if form_decode(key) == name {
            return Some(form_decode(value));
        }
    }
    None
}

fn form_decode(value: &str) -> String {
    let plus = value.replace('+', " ");
    let bytes = plus.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&plus[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn reject_paid_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://api.open-meteo.com/") {
        return Err("Open-Meteo client uses the free api.open-meteo.com host only".to_string());
    }
    let lower = url.to_ascii_lowercase();
    if lower.contains("apikey=") || lower.contains("api_key=") || lower.contains("customer-api") {
        return Err(
            "Open-Meteo client does not send an API key or call a paid endpoint".to_string(),
        );
    }
    Ok(())
}

async fn free_tier_fetch(client: &reqwest::Client, url: &str) -> Result<UpstreamResponse, String> {
    reject_paid_url(url)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Error")
        .to_string();
    let body = response.text().await.map_err(|error| error.to_string())?;
    Ok(UpstreamResponse {
        status,
        body,
        status_text,
    })
}

pub fn error_text(body: &str, status: u16, status_text: &str) -> String {
    let sliced: String = body.chars().take(200).collect();
    if sliced.is_empty() {
        if status_text.is_empty() {
            format!("HTTP {status}")
        } else {
            status_text.to_string()
        }
    } else {
        sliced
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn ok_body(status: u16, body: &str) -> Result<UpstreamResponse, String> {
        Ok(UpstreamResponse {
            status,
            body: body.to_string(),
            status_text: if status == 200 { "OK" } else { "Error" }.to_string(),
        })
    }

    #[tokio::test]
    async fn dedupes_in_flight_calls_then_serves_the_url_from_cache() {
        let calls = Arc::new(AtomicUsize::new(0));
        let (release_tx, release_rx) = watch::channel(false);
        let calls_fetch = calls.clone();
        let fetch: FetchFn = Arc::new(move |_| {
            let calls_fetch = calls_fetch.clone();
            let mut release_rx = release_rx.clone();
            Box::pin(async move {
                calls_fetch.fetch_add(1, Ordering::SeqCst);
                if !*release_rx.borrow() {
                    release_rx.changed().await.ok();
                }
                ok_body(200, r#"{"hourly":{"time":["t"]}}"#)
            })
        });
        let cache = Arc::new(OpenMeteoCache::new(fetch, Clock::at(1_000), tokio_sleep()));
        let url = "https://api.open-meteo.com/v1/forecast?latitude=-33.46&longitude=-70.55&models=gfs_seamless&hourly=temperature_2m";
        let first = {
            let cache_url = url.to_string();
            let cache = cache.clone();
            tokio::spawn(async move {
                cache
                    .cached_fetch(&cache_url, Some("gfs_seamless"))
                    .await
                    .unwrap()
            })
        };
        let second = {
            let cache_url = url.to_string();
            let cache = cache.clone();
            tokio::spawn(async move {
                cache
                    .cached_fetch(&cache_url, Some("gfs_seamless"))
                    .await
                    .unwrap()
            })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        release_tx.send(true).unwrap();
        let (left, right) = tokio::join!(first, second);
        let left = left.unwrap();
        let right = right.unwrap();
        assert_eq!(left.body, right.body);
        assert_eq!(left.cache, Some("miss"));
        let again = cache.cached_fetch(url, Some("gfs_seamless")).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(again.cache, Some("hit"));
    }

    #[tokio::test]
    async fn a_429_is_shared_then_dropped_so_the_retry_hits_the_network() {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_fetch = calls.clone();
        let fetch: FetchFn = Arc::new(move |_| {
            let calls_fetch = calls_fetch.clone();
            Box::pin(async move {
                let n = calls_fetch.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(30)).await;
                if n == 0 {
                    ok_body(429, "slow down")
                } else {
                    ok_body(200, "{}")
                }
            })
        });
        let cache = OpenMeteoCache::new(fetch, Clock::at(1_000), tokio_sleep());
        let url = "https://api.open-meteo.com/v1/forecast?models=ecmwf_ifs025";
        let left = cache.cached_fetch(url, Some("ecmwf_ifs025"));
        let right = cache.cached_fetch(url, Some("ecmwf_ifs025"));
        let (left, right) = tokio::join!(left, right);
        assert_eq!(left.unwrap().status, 429);
        assert_eq!(right.unwrap().status, 429);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let retry = cache.cached_fetch(url, Some("ecmwf_ifs025")).await.unwrap();
        assert_eq!(retry.status, 200);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let cached = cache.cached_fetch(url, Some("ecmwf_ifs025")).await.unwrap();
        assert_eq!(cached.cache, Some("hit"));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_5xx_is_not_stored_and_ttls_follow_the_model() {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_fetch = calls.clone();
        let fetch: FetchFn = Arc::new(move |_| {
            let calls_fetch = calls_fetch.clone();
            Box::pin(async move {
                let n = calls_fetch.fetch_add(1, Ordering::SeqCst);
                ok_body(if n == 0 { 503 } else { 200 }, "upstream")
            })
        });
        let now = Arc::new(std::sync::atomic::AtomicI64::new(10_000));
        let now_clock = now.clone();
        let clock = Clock::from_fn(Arc::new(move || now_clock.load(Ordering::SeqCst)));
        let cache = OpenMeteoCache::new(fetch, clock, tokio_sleep());
        let gfs = "https://api.open-meteo.com/v1/forecast?models=gfs_seamless";
        assert_eq!(cache.cached_fetch(gfs, None).await.unwrap().status, 503);
        assert_eq!(cache.cached_fetch(gfs, None).await.unwrap().status, 200);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        now.store(10_000 + 3 * 60 * 60 * 1000 - 1, Ordering::SeqCst);
        assert_eq!(
            cache.cached_fetch(gfs, None).await.unwrap().cache,
            Some("hit")
        );
        now.store(10_000 + 3 * 60 * 60 * 1000, Ordering::SeqCst);
        assert_eq!(
            cache.cached_fetch(gfs, None).await.unwrap().cache,
            Some("miss")
        );

        let ecmwf =
            "https://api.open-meteo.com/v1/forecast?models=ecmwf_ifs025&hourly=temperature_2m";
        let _ = cache.cached_fetch(ecmwf, None).await.unwrap();
        let calls_at = calls.load(Ordering::SeqCst);
        now.store(
            now.load(Ordering::SeqCst) + 3 * 60 * 60 * 1000,
            Ordering::SeqCst,
        );
        assert_eq!(
            cache.cached_fetch(ecmwf, None).await.unwrap().cache,
            Some("hit")
        );
        now.store(
            now.load(Ordering::SeqCst) + 3 * 60 * 60 * 1000,
            Ordering::SeqCst,
        );
        assert_eq!(
            cache.cached_fetch(ecmwf, None).await.unwrap().cache,
            Some("miss")
        );
        assert!(calls.load(Ordering::SeqCst) > calls_at);
    }

    #[tokio::test]
    async fn the_cache_key_is_the_exact_url_and_paid_hosts_are_refused() {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_fetch = calls.clone();
        let fetch: FetchFn = Arc::new(move |_| {
            let calls_fetch = calls_fetch.clone();
            Box::pin(async move {
                calls_fetch.fetch_add(1, Ordering::SeqCst);
                ok_body(200, "{}")
            })
        });
        let cache = OpenMeteoCache::new(fetch, Clock::at(1), tokio_sleep());
        let a = "https://api.open-meteo.com/v1/forecast?latitude=-33.456&models=gfs_seamless";
        let b = "https://api.open-meteo.com/v1/forecast?models=gfs_seamless&latitude=-33.456";
        cache.cached_fetch(a, Some("gfs_seamless")).await.unwrap();
        cache.cached_fetch(b, Some("gfs_seamless")).await.unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        let refused = cache
            .cached_fetch("https://customer-api.open-meteo.com/v1/forecast", None)
            .await;
        assert!(refused.is_err());
        let keyed = cache
            .cached_fetch("https://api.open-meteo.com/v1/forecast?apikey=secret", None)
            .await;
        assert!(keyed.is_err());
        let api_key = cache
            .cached_fetch(
                "https://api.open-meteo.com/v1/forecast?api_key=secret",
                None,
            )
            .await;
        assert!(api_key.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn batch_size_and_delay_are_read_on_each_call() {
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_fetch = calls.clone();
        let fetch: FetchFn = Arc::new(move |_| {
            let calls_fetch = calls_fetch.clone();
            Box::pin(async move {
                calls_fetch.fetch_add(1, Ordering::SeqCst);
                ok_body(200, "{}")
            })
        });
        let sleeps = Arc::new(Mutex::new(Vec::new()));
        let sleeps_cb = sleeps.clone();
        let sleep: SleepFn = Arc::new(move |ms| {
            let sleeps_cb = sleeps_cb.clone();
            Box::pin(async move {
                sleeps_cb.lock().await.push(ms);
            })
        });
        let cache = OpenMeteoCache::new(fetch, Clock::at(1), sleep);
        let points = [
            crate::domain::GridPoint {
                lat: -33.0,
                lon: -71.0,
            },
            crate::domain::GridPoint {
                lat: -33.1,
                lon: -71.1,
            },
        ];
        let _restore = EnvRestore;
        std::env::set_var("OPEN_METEO_BATCH_SIZE", "2");
        std::env::set_var("OPEN_METEO_BATCH_DELAY_MS", "11");
        assert_eq!(batch_size(), 2);
        assert_eq!(batch_delay_ms(), 11);
        crate::field::fetch_multi(&cache, &points, "gfs_seamless")
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(sleeps.lock().await.is_empty());

        std::env::set_var("OPEN_METEO_BATCH_SIZE", "1");
        std::env::set_var("OPEN_METEO_BATCH_DELAY_MS", "5");
        assert_eq!(batch_size(), 1);
        assert_eq!(batch_delay_ms(), 5);
        crate::field::fetch_multi(&cache, &points, "icon_seamless")
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert_eq!(sleeps.lock().await.as_slice(), [5]);

        std::env::remove_var("OPEN_METEO_BATCH_SIZE");
        std::env::remove_var("OPEN_METEO_BATCH_DELAY_MS");
        assert_eq!(batch_size(), 60);
        assert_eq!(batch_delay_ms(), 250);
    }

    struct EnvRestore;

    impl Drop for EnvRestore {
        fn drop(&mut self) {
            std::env::remove_var("OPEN_METEO_BATCH_SIZE");
            std::env::remove_var("OPEN_METEO_BATCH_DELAY_MS");
        }
    }
}
