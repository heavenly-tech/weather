# Route parity fixtures

These bodies are the TypeScript route output for the recorded SCTB Open-Meteo responses (and a few EXAMPLE upstream failures). `route_parity::routes_match_typescript_bytes` replays them through the Rust routes and compares the JSON bytes. Tests do not open a live weather connection.

## Known deviations from TS

1. **Unknown model on `/api/andes/times`.** TypeScript casts the query and throws, so Next serves an HTML 500. Rust returns `400` `{"error":"Invalid model"}`, the same body the other Andes routes already use. Pinned by `route_parity::unknown_model_on_times_is_400_invalid_model`.
2. **Transport failure on the generated routes.** A failed fetch (no HTTP status) returns `502` JSON `{"error":"Upstream unavailable","code":"transport"}`. Next leaves that throw uncaught. An upstream HTTP status on these routes is the same generic message with code `http-<status>` (`http-503` for the generated METAR 503 fixture). The `/api/andes/times` 429 body is still the 200 `{"times":[],"error":"HTTP 429"}`. The ceiling 429 body says `Upstream unavailable (http-429)` and does not repeat the upstream bytes. Pinned by `route_parity::generated_transport_failure_is_502_json`.
3. **Free-tier host, API key, and redirect hardening.** The client allows only `https://api.open-meteo.com/`, refuses `apikey`, `api_key`, and `customer-api`, and does not follow redirects. TypeScript does not apply these checks. The routes only build free URLs, so the golden bodies do not change. Pinned by `cache::tests::the_cache_key_is_the_exact_url_and_paid_hosts_are_refused` and `client::tests::open_meteo_does_not_follow_redirects`.
4. **Batch size and delay are read on each call.** `OPEN_METEO_BATCH_SIZE` (default 60) and `OPEN_METEO_BATCH_DELAY_MS` (default 250) are read when a batch runs. TypeScript reads them once at import. Pinned by `cache::tests::batch_size_and_delay_are_read_on_each_call`.
