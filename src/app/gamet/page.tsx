import { GametDesk } from "@/components/gamet-desk";
import { buildGamet, parseFir } from "@/lib/gamet";
import { DEFAULT_ICAO, firForStation } from "@/lib/stations";
import { normalizeIcao } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function GametPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const icao = normalizeIcao(params.icao, DEFAULT_ICAO);
  const firParam = Array.isArray(params.fir) ? params.fir[0] : params.fir;
  const fir = parseFir(firParam ?? firForStation(icao));
  const envelope = await buildGamet(fir);
  return <GametDesk fir={fir} envelope={envelope} />;
}
