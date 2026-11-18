//! Shared server state for the Open-Meteo routes.

use std::sync::Arc;
use std::time::Duration;

use crate::cache::{BoxFuture, Clock, FetchFn, OpenMeteoCache, UpstreamResponse};
use crate::field::ProbeCache;
use crate::product_log::ProductLog;

#[derive(Clone)]
pub struct AppState {
    pub cache: Arc<OpenMeteoCache>,
    pub awc: FetchFn,
    pub clock: Clock,
    pub random: Arc<dyn Fn() -> f64 + Send + Sync>,
    pub log: Arc<ProductLog>,
    pub probes: Arc<ProbeCache>,
}

impl AppState {
    pub fn production() -> reqwest::Result<Self> {
        let clock = Clock::system();
        let cache = Arc::new(OpenMeteoCache::production()?);
        let awc_client = awc_client()?;
        let awc: FetchFn = Arc::new(move |url: String| {
            let client = awc_client.clone();
            Box::pin(async move { awc_fetch(&client, &url).await })
        });
        Ok(Self {
            cache,
            awc,
            clock: clock.clone(),
            random: Arc::new(production_random),
            log: Arc::new(ProductLog::new(clock)),
            probes: Arc::new(ProbeCache::new()),
        })
    }

    pub fn for_tests(
        fetch: FetchFn,
        clock: Clock,
        random: Arc<dyn Fn() -> f64 + Send + Sync>,
    ) -> Self {
        let sleep = crate::cache::tokio_sleep();
        Self {
            cache: Arc::new(OpenMeteoCache::new(fetch.clone(), clock.clone(), sleep)),
            awc: fetch,
            clock: clock.clone(),
            random,
            log: Arc::new(ProductLog::new(clock)),
            probes: Arc::new(ProbeCache::new()),
        }
    }
}

fn production_random() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos())
        .unwrap_or(0);
    f64::from(nanos) / 1_000_000_000.0
}

fn awc_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("HeavenlyWeather/1.0 (aviation briefing; weather.heavenly.cl)")
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

fn awc_fetch(client: &reqwest::Client, url: &str) -> BoxFuture<Result<UpstreamResponse, String>> {
    let client = client.clone();
    let url = url.to_string();
    Box::pin(async move {
        match client
            .get(&url)
            .header("accept", "application/json")
            .send()
            .await
        {
            Err(error) if error.is_timeout() => {
                Err("Timed out after 12s waiting for the weather circuit.".to_string())
            }
            Err(error) => Err(error.to_string()),
            Ok(response) => {
                let status = response.status().as_u16();
                let status_text = response
                    .status()
                    .canonical_reason()
                    .unwrap_or("")
                    .to_string();
                let body = response.text().await.map_err(|error| error.to_string())?;
                Ok(UpstreamResponse {
                    status,
                    body,
                    status_text,
                })
            }
        }
    })
}
