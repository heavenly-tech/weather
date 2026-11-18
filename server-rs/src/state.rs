//! Shared server state for the Open-Meteo routes.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::cache::{BoxFuture, Clock, FetchFn, OpenMeteoCache, UpstreamResponse};
use crate::field::ProbeCache;
use crate::product_log::ProductLog;

#[derive(Clone, Debug)]
pub struct BytesResponse {
    pub status: u16,
    pub body: Vec<u8>,
    pub status_text: String,
    pub content_type: String,
}

pub type BytesFn = Arc<dyn Fn(String) -> BoxFuture<Result<BytesResponse, String>> + Send + Sync>;

#[derive(Clone)]
pub struct AppState {
    pub cache: Arc<OpenMeteoCache>,
    pub awc: FetchFn,
    pub binary: BytesFn,
    pub clock: Clock,
    pub random: Arc<dyn Fn() -> f64 + Send + Sync>,
    pub log: Arc<ProductLog>,
    pub probes: Arc<ProbeCache>,
    /// Directory that holds `latest.json` from the local WRF orchestrator.
    pub wrf_output_dir: Option<PathBuf>,
    /// A cycle older than this many hours is "No run available yet".
    pub wrf_max_age_hours: i64,
}

impl AppState {
    pub fn production() -> reqwest::Result<Self> {
        let clock = Clock::system();
        let cache = Arc::new(OpenMeteoCache::production()?);
        let awc_client = awc_client()?;
        let binary_client = awc_client.clone();
        let awc: FetchFn = Arc::new(move |url: String| {
            let client = awc_client.clone();
            Box::pin(async move { awc_fetch(&client, &url).await })
        });
        let binary: BytesFn = Arc::new(move |url: String| {
            let client = binary_client.clone();
            Box::pin(async move { fetch_bytes(&client, &url).await })
        });
        Ok(Self {
            cache,
            awc,
            binary,
            clock: clock.clone(),
            random: Arc::new(production_random),
            log: Arc::new(ProductLog::new(clock)),
            probes: Arc::new(ProbeCache::new()),
            wrf_output_dir: std::env::var("WRF_OUTPUT_DIR")
                .ok()
                .filter(|value| !value.is_empty())
                .map(PathBuf::from),
            wrf_max_age_hours: std::env::var("WRF_LOCAL_MAX_AGE_HOURS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(18),
        })
    }

    pub fn for_tests(
        fetch: FetchFn,
        clock: Clock,
        random: Arc<dyn Fn() -> f64 + Send + Sync>,
    ) -> Self {
        let sleep = crate::cache::tokio_sleep();
        let binary_fetch = fetch.clone();
        let binary: BytesFn = Arc::new(move |url: String| {
            let binary_fetch = binary_fetch.clone();
            Box::pin(async move {
                let response = binary_fetch(url).await?;
                Ok(BytesResponse {
                    status: response.status,
                    body: response.body.into_bytes(),
                    status_text: response.status_text,
                    content_type: "application/octet-stream".to_string(),
                })
            })
        });
        Self {
            cache: Arc::new(OpenMeteoCache::new(fetch.clone(), clock.clone(), sleep)),
            awc: fetch,
            binary,
            clock: clock.clone(),
            random,
            log: Arc::new(ProductLog::new(clock)),
            probes: Arc::new(ProbeCache::new()),
            wrf_output_dir: None,
            wrf_max_age_hours: 18,
        }
    }
}

async fn fetch_bytes(client: &reqwest::Client, url: &str) -> Result<BytesResponse, String> {
    match client.get(url).send().await {
        Err(error) => Err(error.to_string()),
        Ok(response) => {
            let status = response.status().as_u16();
            let status_text = response
                .status()
                .canonical_reason()
                .unwrap_or("")
                .to_string();
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            if !response.status().is_success() {
                return Err(format!("{status} {status_text}"));
            }
            let body = response.bytes().await.map_err(|error| error.to_string())?;
            Ok(BytesResponse {
                status,
                body: body.to_vec(),
                status_text,
                content_type,
            })
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
