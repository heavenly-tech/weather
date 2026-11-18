import { VfrSvfrView } from "@/components/vfr-svfr-view";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import { loadMetar, normalizeIcao } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function VfrSvfrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const icao = normalizeIcao(params.icao, DEFAULT_ICAO);
  const station = getStation(icao);
  const metar = await loadMetar(icao);
  return <VfrSvfrView icao={icao} station={station} metar={metar} />;
}
