import { icaoParam, productResponse } from "@/lib/api";
import { nowIso } from "@/lib/http";
import { fetchMeteoChileWrf } from "@/lib/meteochile";
import { mockForecast } from "@/lib/mocks";
import { asSingle, fetchOpenMeteo, openMeteoSurfaceUrl, toPointForecast } from "@/lib/open-meteo";
import { requireStation } from "@/lib/stations";
import type { PointForecast, ProductEnvelope } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const icao = icaoParam(request);
  const station = requireStation(icao);

  const wrf = await fetchMeteoChileWrf(icao);
  if (wrf && wrf.hours.length) {
    const envelope: ProductEnvelope<PointForecast> = {
      data: wrf,
      source: "live",
      sourceLabel: "Live WRF-DMC from MeteoChile",
      fetchedAt: nowIso(),
    };
    return productResponse(envelope);
  }

  const meteo = await fetchOpenMeteo(openMeteoSurfaceUrl(station.lat, station.lon, 5));
  if (meteo.ok) {
    const data = toPointForecast(
      station.icao,
      `${station.city} / ${station.name}`,
      "GFS via Open-Meteo (WRF-DMC parent model)",
      asSingle(meteo.data)
    );
    const envelope: ProductEnvelope<PointForecast> = {
      data,
      source: "fallback",
      sourceLabel: process.env.METEOCHILE_TOKEN
        ? "Open-Meteo GFS (MeteoChile WRF did not return a series)"
        : "Open-Meteo GFS fallback — set METEOCHILE_USER and METEOCHILE_TOKEN for WRF-DMC",
      fetchedAt: nowIso(),
      warning: station.meteochileId
        ? undefined
        : `No MeteoChile station id mapped for ${station.icao}; GFS is used at the aerodrome coordinates.`,
    };
    return productResponse(envelope);
  }

  const envelope: ProductEnvelope<PointForecast> = {
    data: mockForecast(icao),
    source: "mock",
    sourceLabel: "Mock point forecast (model circuit down)",
    fetchedAt: nowIso(),
    warning: meteo.error,
  };
  return productResponse(envelope);
}
