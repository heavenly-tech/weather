import { fetchJson, nowIso } from "@/lib/http";
import { parseAwcMetar } from "@/lib/awc";
import { mockMetar } from "@/lib/mocks";
import { icaoParam, productResponse } from "@/lib/api";
import { getStation } from "@/lib/stations";
import type { MetarObservation, ProductEnvelope } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const icao = icaoParam(request);
  const result = await fetchJson<unknown[]>(
    `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`
  );

  if (!result.ok || !Array.isArray(result.data) || result.data.length === 0) {
    const envelope: ProductEnvelope<MetarObservation> = {
      data: mockMetar(icao),
      source: "mock",
      sourceLabel: "Mock METAR (AWC did not return an observation)",
      fetchedAt: nowIso(),
      warning: result.ok ? `No METAR on file for ${icao}.` : result.error,
    };
    return productResponse(envelope);
  }

  const parsed = parseAwcMetar(result.data[0] as Parameters<typeof parseAwcMetar>[0]);
  const station = getStation(icao);
  const envelope: ProductEnvelope<MetarObservation> = {
    data: {
      ...parsed,
      icao: parsed.icao || icao,
      name: parsed.name || (station ? `${station.city} / ${station.name}` : icao),
    },
    source: "live",
    sourceLabel: "Live METAR from NOAA Aviation Weather Center",
    fetchedAt: nowIso(),
  };
  return productResponse(envelope);
}
