import { VizDesk } from "@/components/viz-desk";
import { DEFAULT_ICAO } from "@/lib/stations";
import { loadViz, normalizeIcao } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function VizPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const icao = normalizeIcao(params.icao, DEFAULT_ICAO);
  const envelope = await loadViz(icao);
  return <VizDesk icao={icao} envelope={envelope} />;
}
