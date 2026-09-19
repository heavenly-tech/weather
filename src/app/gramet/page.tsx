import { GrametDesk } from "@/components/gramet-desk";
import { DEFAULT_ICAO } from "@/lib/stations";
import { buildGramet } from "@/lib/gramet";
import { normalizeIcao } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function GrametPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const icao = normalizeIcao(params.icao, DEFAULT_ICAO);
  const from = normalizeIcao(params.from, icao);
  const to = normalizeIcao(params.to, "SCTE");
  const envelope = await buildGramet(from, to);
  return <GrametDesk from={from} to={to} envelope={envelope} />;
}
