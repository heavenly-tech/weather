import { BriefingView } from "@/components/briefing-view";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import { loadMetar, loadTaf, normalizeIcao } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const icao = normalizeIcao(params.icao, DEFAULT_ICAO);
  const station = getStation(icao);
  const [metar, taf] = await Promise.all([loadMetar(icao), loadTaf(icao)]);
  return <BriefingView icao={icao} station={station} metar={metar} taf={taf} />;
}
