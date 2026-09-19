import { fetchJson, nowIso } from "@/lib/http";
import { parseAwcTaf } from "@/lib/awc";
import { mockTaf } from "@/lib/mocks";
import { icaoParam, productResponse } from "@/lib/api";
import { getStation } from "@/lib/stations";
import type { ProductEnvelope, TafForecast } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const icao = icaoParam(request);
  const result = await fetchJson<unknown[]>(
    `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=json`
  );

  if (!result.ok || !Array.isArray(result.data) || result.data.length === 0) {
    const envelope: ProductEnvelope<TafForecast> = {
      data: mockTaf(icao),
      source: "mock",
      sourceLabel: "Mock TAF (AWC did not return a forecast)",
      fetchedAt: nowIso(),
      warning: result.ok ? `No TAF on file for ${icao}.` : result.error,
    };
    return productResponse(envelope);
  }

  const parsed = parseAwcTaf(result.data[0] as Parameters<typeof parseAwcTaf>[0]);
  const station = getStation(icao);
  const envelope: ProductEnvelope<TafForecast> = {
    data: {
      ...parsed,
      icao: parsed.icao || icao,
      name: parsed.name || (station ? `${station.city} / ${station.name}` : icao),
    },
    source: "live",
    sourceLabel: "Live TAF from NOAA Aviation Weather Center",
    fetchedAt: nowIso(),
  };
  return productResponse(envelope);
}
