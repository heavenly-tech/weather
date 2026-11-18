//! TTL cache, rate limits, and exponential backoff for DGAC IFIS fetches.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::cache::{Clock, FetchFn};
use crate::official_ifis::{self, ParseFailure, ParsedMetar, ParsedTaf};

const BASE_BACKOFF_MS: i64 = 4_000;
const MAX_BACKOFF_MS: i64 = 64_000;

#[derive(Clone)]
pub struct OfficialIfis {
    inner: Arc<OfficialInner>,
}

struct OfficialInner {
    fetch: FetchFn,
    clock: Clock,
    state: Mutex<CacheState>,
}

struct CacheState {
    metar: HashMap<String, CachedProduct<ParsedMetar>>,
    taf: HashMap<String, CachedProduct<ParsedTaf>>,
    last_global_fetch_ms: i64,
    last_icao_fetch_ms: HashMap<String, i64>,
    backoff_until: HashMap<String, i64>,
    fail_streak: HashMap<String, u32>,
}

#[derive(Clone)]
struct CachedProduct<T> {
    parsed: T,
    fetched_at_ms: i64,
    expires_at_ms: i64,
    source_url: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OfficialMetarPayload {
    pub icao: String,
    pub raw: String,
    pub kind: String,
    pub source: &'static str,
    pub official_label: &'static str,
    pub source_url: String,
    pub fetched_at: String,
    pub issued_at: Option<String>,
    pub age_seconds: i64,
    pub stale: bool,
    pub unavailable: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OfficialTafPayload {
    pub icao: String,
    pub raw: String,
    pub source: &'static str,
    pub official_label: &'static str,
    pub source_url: String,
    pub fetched_at: String,
    pub issued_at: Option<String>,
    pub age_seconds: i64,
    pub stale: bool,
    pub unavailable: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OfficialGametPayload {
    pub fir: String,
    pub source: &'static str,
    pub official_label: &'static str,
    pub fetched_at: String,
    pub unavailable: bool,
    pub unavailable_reason: String,
}

enum ProductKind {
    Metar,
    Taf,
}

impl OfficialIfis {
    pub fn new(fetch: FetchFn, clock: Clock) -> Self {
        Self {
            inner: Arc::new(OfficialInner {
                fetch,
                clock,
                state: Mutex::new(CacheState {
                    metar: HashMap::new(),
                    taf: HashMap::new(),
                    last_global_fetch_ms: 0,
                    last_icao_fetch_ms: HashMap::new(),
                    backoff_until: HashMap::new(),
                    fail_streak: HashMap::new(),
                }),
            }),
        }
    }

    pub async fn metar(&self, icao: &str) -> OfficialMetarPayload {
        let icao = icao.trim().to_ascii_uppercase();
        let now = self.inner.clock.now_ms();
        let now_stamp = crate::utc::UtcStamp::from_epoch_ms(now);
        if !official_ifis::allowed_icao(&icao) {
            return unavailable_metar(&icao, &self.inner.clock, "icao_not_supported", None);
        }
        match self.load_metar(&icao, now).await {
            Ok(entry) => metar_payload(&icao, entry, now_stamp),
            Err(reason) => unavailable_metar(
                &icao,
                &self.inner.clock,
                reason,
                Some(official_ifis::metar_url(&icao)),
            ),
        }
    }

    pub async fn taf(&self, icao: &str) -> OfficialTafPayload {
        let icao = icao.trim().to_ascii_uppercase();
        let now = self.inner.clock.now_ms();
        let now_stamp = crate::utc::UtcStamp::from_epoch_ms(now);
        if !official_ifis::allowed_icao(&icao) {
            return unavailable_taf(&icao, &self.inner.clock, "icao_not_supported", None);
        }
        match self.load_taf(&icao, now).await {
            Ok(entry) => taf_payload(&icao, entry, now_stamp),
            Err(reason) => unavailable_taf(
                &icao,
                &self.inner.clock,
                reason,
                Some(official_ifis::taf_url(&icao)),
            ),
        }
    }

    pub fn gamet(&self, fir: &str) -> OfficialGametPayload {
        let fir = fir.trim().to_ascii_uppercase();
        let mapped = match fir.as_str() {
            "SCEZ" => "SANTIAGO",
            other if official_ifis::allowed_fir(other) => other,
            _ => "SANTIAGO",
        };
        OfficialGametPayload {
            fir: mapped.to_string(),
            source: official_ifis::SOURCE,
            official_label: official_ifis::OFFICIAL_LABEL,
            fetched_at: self.inner.clock.now_iso(),
            unavailable: true,
            unavailable_reason: "opmet_only".to_string(),
        }
    }

    async fn load_metar(
        &self,
        icao: &str,
        now: i64,
    ) -> Result<CachedProduct<ParsedMetar>, &'static str> {
        if let Some(entry) = self.fresh_metar(icao, now).await {
            return Ok(entry);
        }
        let stale = self.stale_metar(icao, now).await;
        if self.in_backoff(icao, ProductKind::Metar, now).await {
            return stale.ok_or("backoff");
        }
        if !self.rate_ok(icao, now).await {
            return stale.ok_or("rate_limited");
        }
        let source_url = official_ifis::metar_url(icao);
        match self.fetch_html(&source_url).await {
            Ok(html) => {
                self.clear_failure(icao, ProductKind::Metar).await;
                let parsed =
                    official_ifis::parse_metar_html(&html, icao).map_err(|err| match err {
                        ParseFailure::NoMetar => "parse_no_metar",
                        _ => "parse_error",
                    })?;
                let entry = CachedProduct {
                    parsed,
                    fetched_at_ms: now,
                    expires_at_ms: now + official_ifis::METAR_TTL_MS,
                    source_url,
                };
                self.store_metar(icao, entry.clone()).await;
                Ok(entry)
            }
            Err(reason) => {
                self.record_failure(icao, ProductKind::Metar, now).await;
                stale.ok_or(reason)
            }
        }
    }

    async fn load_taf(
        &self,
        icao: &str,
        now: i64,
    ) -> Result<CachedProduct<ParsedTaf>, &'static str> {
        if let Some(entry) = self.fresh_taf(icao, now).await {
            return Ok(entry);
        }
        let stale = self.stale_taf(icao, now).await;
        if self.in_backoff(icao, ProductKind::Taf, now).await {
            return stale.ok_or("backoff");
        }
        if !self.rate_ok(icao, now).await {
            return stale.ok_or("rate_limited");
        }
        let source_url = official_ifis::taf_url(icao);
        match self.fetch_html(&source_url).await {
            Ok(html) => {
                self.clear_failure(icao, ProductKind::Taf).await;
                let parsed =
                    official_ifis::parse_taf_html(&html, icao).map_err(|err| match err {
                        ParseFailure::NoTafForDesignator => "no_taf_for_designator",
                        ParseFailure::NoTaf => "parse_no_taf",
                        _ => "parse_error",
                    })?;
                let entry = CachedProduct {
                    parsed,
                    fetched_at_ms: now,
                    expires_at_ms: now + official_ifis::TAF_TTL_MS,
                    source_url,
                };
                self.store_taf(icao, entry.clone()).await;
                Ok(entry)
            }
            Err(reason) => {
                self.record_failure(icao, ProductKind::Taf, now).await;
                stale.ok_or(reason)
            }
        }
    }

    async fn fresh_metar(&self, icao: &str, now: i64) -> Option<CachedProduct<ParsedMetar>> {
        let guard = self.inner.state.lock().await;
        guard
            .metar
            .get(icao)
            .filter(|entry| entry.expires_at_ms > now)
            .cloned()
    }

    async fn fresh_taf(&self, icao: &str, now: i64) -> Option<CachedProduct<ParsedTaf>> {
        let guard = self.inner.state.lock().await;
        guard
            .taf
            .get(icao)
            .filter(|entry| entry.expires_at_ms > now)
            .cloned()
    }

    async fn stale_metar(&self, icao: &str, now: i64) -> Option<CachedProduct<ParsedMetar>> {
        let guard = self.inner.state.lock().await;
        guard
            .metar
            .get(icao)
            .filter(|entry| entry.expires_at_ms <= now)
            .cloned()
    }

    async fn stale_taf(&self, icao: &str, now: i64) -> Option<CachedProduct<ParsedTaf>> {
        let guard = self.inner.state.lock().await;
        guard
            .taf
            .get(icao)
            .filter(|entry| entry.expires_at_ms <= now)
            .cloned()
    }

    async fn store_metar(&self, icao: &str, entry: CachedProduct<ParsedMetar>) {
        let mut guard = self.inner.state.lock().await;
        guard.metar.insert(icao.to_string(), entry);
    }

    async fn store_taf(&self, icao: &str, entry: CachedProduct<ParsedTaf>) {
        let mut guard = self.inner.state.lock().await;
        guard.taf.insert(icao.to_string(), entry);
    }

    async fn fetch_html(&self, url: &str) -> Result<String, &'static str> {
        let response = (self.inner.fetch)(url.to_string())
            .await
            .map_err(|_| "ifis_timeout")?;
        if response.status == 404 || response.status >= 500 {
            return Err("ifis_http_error");
        }
        if response.status != 200 {
            return Err("ifis_http_error");
        }
        Ok(response.body)
    }

    async fn rate_ok(&self, icao: &str, now: i64) -> bool {
        let mut guard = self.inner.state.lock().await;
        if now - guard.last_global_fetch_ms < official_ifis::GLOBAL_MIN_INTERVAL_MS {
            return false;
        }
        if let Some(last) = guard.last_icao_fetch_ms.get(icao) {
            if now - *last < official_ifis::PER_ICAO_MIN_INTERVAL_MS {
                return false;
            }
        }
        guard.last_global_fetch_ms = now;
        guard.last_icao_fetch_ms.insert(icao.to_string(), now);
        true
    }

    async fn in_backoff(&self, icao: &str, kind: ProductKind, now: i64) -> bool {
        let key = backoff_key(icao, kind);
        let guard = self.inner.state.lock().await;
        guard
            .backoff_until
            .get(&key)
            .is_some_and(|until| now < *until)
    }

    async fn record_failure(&self, icao: &str, kind: ProductKind, now: i64) {
        let key = backoff_key(icao, kind);
        let mut guard = self.inner.state.lock().await;
        let streak = guard.fail_streak.entry(key.clone()).or_insert(0);
        *streak += 1;
        let shift = (*streak).min(4);
        let delay = (BASE_BACKOFF_MS << shift).min(MAX_BACKOFF_MS);
        guard.backoff_until.insert(key, now + delay);
    }

    async fn clear_failure(&self, icao: &str, kind: ProductKind) {
        let key = backoff_key(icao, kind);
        let mut guard = self.inner.state.lock().await;
        guard.backoff_until.remove(&key);
        guard.fail_streak.remove(&key);
    }
}

fn backoff_key(icao: &str, kind: ProductKind) -> String {
    match kind {
        ProductKind::Metar => format!("metar:{icao}"),
        ProductKind::Taf => format!("taf:{icao}"),
    }
}

fn metar_payload(
    icao: &str,
    entry: CachedProduct<ParsedMetar>,
    now: crate::utc::UtcStamp,
) -> OfficialMetarPayload {
    let issued =
        official_ifis::resolved_issue(entry.parsed.header_issued_at, &entry.parsed.raw, now);
    let age_seconds = issued
        .map(|stamp| official_ifis::age_seconds(now, stamp))
        .unwrap_or(-1);
    let stale = age_seconds >= 0 && official_ifis::stale_metar(age_seconds);
    OfficialMetarPayload {
        icao: icao.to_string(),
        raw: entry.parsed.raw,
        kind: entry.parsed.kind,
        source: official_ifis::SOURCE,
        official_label: official_ifis::OFFICIAL_LABEL,
        source_url: entry.source_url,
        fetched_at: crate::utc::UtcStamp::from_epoch_ms(entry.fetched_at_ms).to_iso(),
        issued_at: issued.map(|stamp| stamp.to_iso()),
        age_seconds,
        stale,
        unavailable: false,
        unavailable_reason: None,
    }
}

fn taf_payload(
    icao: &str,
    entry: CachedProduct<ParsedTaf>,
    now: crate::utc::UtcStamp,
) -> OfficialTafPayload {
    let issued =
        official_ifis::resolved_issue(entry.parsed.header_issued_at, &entry.parsed.raw, now);
    let age_seconds = issued
        .map(|stamp| official_ifis::age_seconds(now, stamp))
        .unwrap_or(-1);
    let stale =
        !entry.parsed.raw.is_empty() && official_ifis::stale_taf(&entry.parsed.raw, now, issued);
    OfficialTafPayload {
        icao: icao.to_string(),
        raw: entry.parsed.raw,
        source: official_ifis::SOURCE,
        official_label: official_ifis::OFFICIAL_LABEL,
        source_url: entry.source_url,
        fetched_at: crate::utc::UtcStamp::from_epoch_ms(entry.fetched_at_ms).to_iso(),
        issued_at: issued.map(|stamp| stamp.to_iso()),
        age_seconds,
        stale,
        unavailable: false,
        unavailable_reason: None,
    }
}

fn unavailable_metar(
    icao: &str,
    clock: &Clock,
    reason: &'static str,
    source_url: Option<String>,
) -> OfficialMetarPayload {
    OfficialMetarPayload {
        icao: icao.to_string(),
        raw: String::new(),
        kind: "METAR".to_string(),
        source: official_ifis::SOURCE,
        official_label: official_ifis::OFFICIAL_LABEL,
        source_url: source_url.unwrap_or_else(|| official_ifis::metar_url(icao)),
        fetched_at: clock.now_iso(),
        issued_at: None,
        age_seconds: -1,
        stale: false,
        unavailable: true,
        unavailable_reason: Some(reason.to_string()),
    }
}

fn unavailable_taf(
    icao: &str,
    clock: &Clock,
    reason: &'static str,
    source_url: Option<String>,
) -> OfficialTafPayload {
    OfficialTafPayload {
        icao: icao.to_string(),
        raw: String::new(),
        source: official_ifis::SOURCE,
        official_label: official_ifis::OFFICIAL_LABEL,
        source_url: source_url.unwrap_or_else(|| official_ifis::taf_url(icao)),
        fetched_at: clock.now_iso(),
        issued_at: None,
        age_seconds: -1,
        stale: false,
        unavailable: true,
        unavailable_reason: Some(reason.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::UpstreamResponse;
    use crate::utc::parse_utc_iso;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn fixture_fetch() -> FetchFn {
        let metar = std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/official/metar-sctb.html"),
        )
        .unwrap();
        let taf = std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/official/taf-sctb.html"),
        )
        .unwrap();
        let no_taf = std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/official/taf-scvh-none.html"),
        )
        .unwrap();
        Arc::new(move |url: String| {
            let body = if url.contains("/metar") {
                metar.clone()
            } else if url.contains("SCVH") {
                no_taf.clone()
            } else {
                taf.clone()
            };
            Box::pin(async move {
                Ok(UpstreamResponse {
                    status: 200,
                    body,
                    status_text: "OK".to_string(),
                })
            })
        })
    }

    #[tokio::test]
    async fn cache_serves_second_call_without_upstream() {
        let calls = Arc::new(AtomicUsize::new(0));
        let metar_fixture = std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/official/metar-sctb.html"),
        )
        .unwrap();
        let fetch: FetchFn = {
            let metar_fixture = metar_fixture.clone();
            let calls = calls.clone();
            Arc::new(move |url: String| {
                let metar_fixture = metar_fixture.clone();
                let calls = calls.clone();
                Box::pin(async move {
                    if url.contains("/metar") {
                        calls.fetch_add(1, Ordering::SeqCst);
                    }
                    Ok(UpstreamResponse {
                        status: 200,
                        body: metar_fixture,
                        status_text: "OK".to_string(),
                    })
                })
            })
        };
        let clock = Clock::at(parse_utc_iso("2026-11-18T13:05:00Z").unwrap().epoch_ms());
        let client = OfficialIfis::new(fetch, clock);
        let first = client.metar("SCTB").await;
        let second = client.metar("SCTB").await;
        assert!(!first.unavailable);
        assert_eq!(first.raw, second.raw);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(first.source_url.contains("aipchile.dgac.gob.cl"));
    }

    #[tokio::test]
    async fn scvh_taf_unavailable() {
        let client = OfficialIfis::new(
            fixture_fetch(),
            Clock::at(parse_utc_iso("2026-11-18T13:00:00Z").unwrap().epoch_ms()),
        );
        let payload = client.taf("SCVH").await;
        assert!(payload.unavailable);
        assert_eq!(
            payload.unavailable_reason.as_deref(),
            Some("no_taf_for_designator")
        );
    }

    #[tokio::test]
    async fn stale_metar_marked() {
        let client = OfficialIfis::new(
            fixture_fetch(),
            Clock::at(parse_utc_iso("2026-11-18T15:30:00Z").unwrap().epoch_ms()),
        );
        let payload = client.metar("SCTB").await;
        assert!(payload.stale);
        assert!(payload.age_seconds > official_ifis::METAR_STALE_SECS);
    }

    #[tokio::test]
    async fn taf_valid_despite_old_issue() {
        let client = OfficialIfis::new(
            fixture_fetch(),
            Clock::at(parse_utc_iso("2026-11-18T13:05:00Z").unwrap().epoch_ms()),
        );
        let payload = client.taf("SCTB").await;
        assert!(!payload.unavailable);
        assert!(
            !payload.stale,
            "TAF inside 1812/1824 validity must not be age-stale"
        );
        assert!(payload.age_seconds > 60 * 60);
    }

    #[tokio::test]
    async fn taf_stale_after_validity_ends() {
        let client = OfficialIfis::new(
            fixture_fetch(),
            Clock::at(parse_utc_iso("2026-11-19T04:00:00Z").unwrap().epoch_ms()),
        );
        let payload = client.taf("SCTB").await;
        assert!(!payload.unavailable);
        assert!(payload.stale);
    }

    #[tokio::test]
    async fn backoff_after_upstream_error() {
        let fails = Arc::new(AtomicUsize::new(0));
        let fetch: FetchFn = {
            let fails = fails.clone();
            Arc::new(move |_url: String| {
                let fails = fails.clone();
                Box::pin(async move {
                    fails.fetch_add(1, Ordering::SeqCst);
                    Ok(UpstreamResponse {
                        status: 503,
                        body: String::new(),
                        status_text: "Service Unavailable".to_string(),
                    })
                })
            })
        };
        let clock = Clock::at(parse_utc_iso("2026-11-18T13:00:00Z").unwrap().epoch_ms());
        let client = OfficialIfis::new(fetch, clock);
        let first = client.metar("SCTB").await;
        assert!(first.unavailable);
        assert_eq!(first.unavailable_reason.as_deref(), Some("ifis_http_error"));
        let second = client.metar("SCTB").await;
        assert!(second.unavailable);
        assert_eq!(second.unavailable_reason.as_deref(), Some("backoff"));
        assert_eq!(fails.load(Ordering::SeqCst), 1);
    }
}
