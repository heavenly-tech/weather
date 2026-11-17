/**
 * In-memory cache for Open-Meteo responses (server-side).
 *
 * Free non-commercial tier only: `https://api.open-meteo.com` with no API key
 * and no customer endpoint. Fair-use cap is 10,000 requests/day
 * (https://open-meteo.com/en/terms). TTLs follow model update cadence so the
 * same airfield/model/hour URL is not fetched twice. Identical in-flight
 * requests share one fetch.
 */

type CacheEntry = { body: string; expiresAt: number };

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Response>>();

export function clearOpenMeteoCache(): void {
  store.clear();
  inflight.clear();
}

function modelHintFromUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("models") ?? undefined;
  } catch {
    return undefined;
  }
}

const TTL_MS: Record<string, number> = {
  gfs_seamless: 3 * 60 * 60 * 1000,
  ecmwf_ifs025: 6 * 60 * 60 * 1000,
  icon_seamless: 3 * 60 * 60 * 1000,
  gem_seamless: 6 * 60 * 60 * 1000,
  elevation: 30 * 24 * 60 * 60 * 1000,
  default: 15 * 60 * 1000,
};

export function cacheTtlForModel(model: string): number {
  return TTL_MS[model] ?? TTL_MS.default;
}

export function cachedFetchUrl(url: string, modelHint?: string): Promise<Response> {
  const now = Date.now();
  const hit = store.get(url);
  if (hit && hit.expiresAt > now) {
    return Promise.resolve(
      new Response(hit.body, { status: 200, headers: { "content-type": "application/json", "x-open-meteo-cache": "hit" } })
    );
  }
  const pending = inflight.get(url);
  if (pending) return pending.then((res) => res.clone());

  const promise = fetch(url, {
    headers: { "User-Agent": "heavenly-weather/0.1 (andes-viewer; non-commercial; respect-rate-limits)" },
  })
    .then(async (res) => {
      if (!res.ok) return res;
      const body = await res.text();
      const ttl = cacheTtlForModel(modelHint ?? modelHintFromUrl(url) ?? "default");
      store.set(url, { body, expiresAt: Date.now() + ttl });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json", "x-open-meteo-cache": "miss" },
      });
    })
    .finally(() => {
      inflight.delete(url);
    });
  inflight.set(url, promise);
  return promise.then((res) => res.clone());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Open-Meteo allows many coordinates; we batch to keep URLs reasonable and be polite. */
export const OPEN_METEO_BATCH_SIZE = Number(process.env.OPEN_METEO_BATCH_SIZE ?? 60);
export const OPEN_METEO_BATCH_DELAY_MS = Number(process.env.OPEN_METEO_BATCH_DELAY_MS ?? 250);