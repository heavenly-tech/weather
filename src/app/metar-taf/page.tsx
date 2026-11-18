import { MetarTafView } from "@/components/metar-taf-view";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import { loadMetar, loadTaf, normalizeIcao } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function MetarTafPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const icao = normalizeIcao(params.icao, DEFAULT_ICAO);
  const station = getStation(icao);
  const [metar, taf] = await Promise.all([loadMetar(icao), loadTaf(icao)]);
  return <MetarTafView station={station} icao={icao} metar={metar} taf={taf} />;
}
