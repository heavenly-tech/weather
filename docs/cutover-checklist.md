# Cutover checklist

Every item is blocking. This pull request does not deploy and does not merge. Production stays on the current image until Pablo checks item 5.

## 1. Shared client fetch

`src/lib/client-fetch.ts` is the only browser `fetch`. A response that is not ok throws `Error` with the JSON `error` string:

```ts
if (!r.ok) throw new Error(await errorMessage(r));
```

The test that pins a 502 is `src/lib/client-fetch.test.ts` (`a 502 JSON response takes the error path`). A walk of `src/components`, `src/client`, and `src/app` fails if another file calls `fetch(`. After this PR the server libraries `src/lib/http.ts` and `src/lib/andes/open-meteo-cache.ts` are gone, so a repo grep of `\bfetch\s*\(` under `src` finds the helper only.

No cutover without this helper, that test, and a clean grep.

## 2. Staging dual run

Run the previous Node image and the Rust scratch image side by side. Do this on a staging host, not on the production proxy.

```bash
# NODE_IMAGE is the kept Node tag. RUST_IMAGE is the scratch image.
docker compose -f deploy/staging-dual-run.yml up -d
node scripts/dual-run-diff.mjs --node http://127.0.0.1:4311 --rust http://127.0.0.1:4310
```

The script requests all 18 `/api` routes. Station routes are requested for SCTB, SCEL, and SCVM. Routes with no station (`health`, `config`, `andes/models`, `andes/times`, `andes/ceiling`, `andes/slice`, `synoptic`, `synoptic/image`) are requested once. `synoptic/image` is compared as raw bytes. Status and body bytes must match.

One probe is an explained difference, and the script allows only that shape:

- `GET /api/andes/times?model=not-a-model`: Node status 500, Rust status 400 with body `{"error":"Invalid model"}`.

These other differences are documented and pinned by Rust tests. They are not expected on the live probe above, and the script does not ignore them if they show up on a normal route:

- A failed fetch with no HTTP status on the generated routes is `502` JSON `{"error":"Upstream unavailable","code":"transport"}` on Rust. Next left that throw uncaught.
- The Rust Open-Meteo client allows only `https://api.open-meteo.com/`, refuses `apikey` / `api_key` / `customer-api`, and does not follow redirects.
- `OPEN_METEO_BATCH_SIZE` and `OPEN_METEO_BATCH_DELAY_MS` are read on each batch.
- An Open-Meteo 200 that is not JSON is `502` JSON `{"error":"Upstream unavailable","code":"bad-json"}` on Rust. Next served an HTML 500.
- An AWC 200 that is not JSON is an observations-unavailable envelope. It is not a mock METAR or TAF unless `WEATHER_DEV_MOCK=1`.

`node scripts/dual-run-diff.mjs --self-test` checks the route count and that classifier without opening a socket. CI runs the self-test. It does not run the live compare.

Zero unexplained diffs. Re-run if the only mismatch is an observation that changed between the two requests. Do not treat that as a pass by editing the allowlist.

## 3. Rollback

The rollback image is Infrastructure's prebuilt `app-heavenly-weather:node`, built on omarchibald. Digest `sha256:e5e39b4686a93f862bc790b4ed09815330cf118a11e55cf4e4926710b6ac1972` (381 MB). Load it onto heavenly and check the digest before the swap:

```bash
docker save app-heavenly-weather:node | ssh heavenly docker load
ssh heavenly 'docker image inspect app-heavenly-weather:node --format "{{.Id}} {{json .RepoDigests}} {{.Size}}"'
```

The inspect output must contain `sha256:e5e39b4686a93f862bc790b4ed09815330cf118a11e55cf4e4926710b6ac1972` before `app-heavenly-weather:latest` is pointed at the scratch image. `docker load` keeps the image id; a registry digest shows up in `RepoDigests` when one was recorded. Do not rebuild this Node image on the VPS. `main`'s Node Dockerfile no longer builds on current `node:22-alpine` (Alpine 3.24.4): `nogroup` and `nobody` already exist as 65533 and 65534, so `addgroup --system --gid 65534 nogroup` exits 1. The workaround on that Dockerfile is to skip `addgroup` / `adduser` and keep `USER 65534`. There is no separate PR for that, because the Node Dockerfile leaves the runtime image at cutover.

One-command rollback, from a machine that can `ssh heavenly`:

```bash
ssh heavenly 'docker tag app-heavenly-weather:node app-heavenly-weather:latest && cd /opt/stacks/app-heavenly-weather && docker compose up -d --no-build --force-recreate'
```

`deploy.sh` prints the same command and refuses to build.

## 4. Database and state

There is no database and no migration.

- The Open-Meteo cache is in memory and disappears when the process exits.
- The elevation grid is read-only at `WEATHER_ELEVATION=/app/data/andes-fine-elevation.json` inside the image.
- The product log is off unless `PRODUCT_LOG_ENABLED=1`. The image sets `PRODUCT_LOG_PATH=/app/data/product-log.jsonl`. `/app/data` is the container filesystem, not a volume. Turning the log on does not survive `docker rm` unless someone adds a volume later.
- Rollback does not restore or discard application data.

## 5. Pablo's explicit OK

Do not point `weather.heavenly.cl` at the scratch image until Pablo says so. This PR does not deploy.

## 6. Post-cutover WRF smoke

After the scratch image is on `weather.heavenly.cl`, Infrastructure opens the WRF page on production with the real `METEOCHILE_USER` and `METEOCHILE_TOKEN`. The page must show the live WRF-DMC series. Any mismatch with the Node image is a rollback, using the command in item 3.

## What Infrastructure runs

Build on omarchibald or the Mac mini, for `linux/amd64`. Do not build on the heavenly VPS.

```bash
docker build --platform linux/amd64 -t app-heavenly-weather:latest .
docker save app-heavenly-weather:latest | ssh heavenly docker load
```

Load and verify the Node image digest first (item 3), then `./deploy.sh`. That git-updates `/opt/stacks/app-heavenly-weather` and runs `docker compose up -d --no-build --pull never`. If `app-heavenly-weather:latest` is not loaded, the script stops.

`METEOCHILE_USER` and `METEOCHILE_TOKEN` stay in the env file beside compose on the server. They are not arguments to `deploy.sh`.

For the dual run, both containers need outbound HTTPS to `aviationweather.gov`, `api.open-meteo.com`, and the NOAA chart host. Give them the same MeteoChile env if the WRF page should match; without it both fall back to Open-Meteo GFS.

### Env the binary still reads

| Variable | Production value |
| --- | --- |
| `PORT` | `4310`, unchanged |
| `VIRTUAL_HOST`, `LETSENCRYPT_HOST`, `VIRTUAL_PORT` | unchanged, for nginx-proxy |
| `METEOCHILE_USER`, `METEOCHILE_TOKEN` | unchanged, optional |
| `CESIUM_ION_TOKEN` or `NEXT_PUBLIC_CESIUM_ION_TOKEN` | optional; world terrain is not in the CSP, so a token falls back to the ellipsoid |
| `SSL_CERT_FILE` | `/etc/ssl/cert.pem`, set in the image |
| `WEATHER_DIST` | `/app/dist`, set in the image |
| `WEATHER_ELEVATION` | `/app/data/andes-fine-elevation.json`, set in the image |
| `PRODUCT_LOG_PATH` | `/app/data/product-log.jsonl`, set in the image |
| `PRODUCT_LOG_ENABLED` | `0` in the image |
| `OPEN_METEO_BATCH_SIZE`, `OPEN_METEO_BATCH_DELAY_MS`, `ANDES_RENDER_SUBDIV` | optional, unchanged |

`NODE_ENV` and `HOSTNAME` remain in compose so an existing env file does not have to change. The binary ignores them and binds `0.0.0.0`. Compose healthcheck is `/weather healthcheck`. Scratch has no shell and no Node.

## CSP

HTML responses send:

`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self' https://tile.openstreetmap.org; font-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'`

Desk JSON goes through `/api`, so `connect-src` is `'self'` plus the OpenStreetMap tile host the globe actually requests. `style-src` allows the inline style attributes Cesium writes on its widget. `script-src` does not allow `'unsafe-eval'`. The 3D field and the Andes map use `CesiumWidget`, not `Viewer`, so Knockout is not in the bundle. CI runs `node scripts/check-csp-globe.mjs` against the scratch image and fails if the globe canvas does not render or the console reports a CSP violation.

The TAF TEMPO cloud row renders bases in feet with a space and a unit (`SCT 8000 ft, BKN 20000 ft`).
