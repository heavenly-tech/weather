import { ForecastView } from "@/components/forecast-view";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import { loadForecast, normalizeIcao } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const icao = normalizeIcao(params.icao, DEFAULT_ICAO);
  const station = getStation(icao);
  const product = await loadForecast(icao);
  return <ForecastView icao={icao} station={station} product={product} />;
}
