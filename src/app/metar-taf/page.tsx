import { MetarPanel, TafPanel } from "@/components/metar-taf-panels";
import { ProductEmpty } from "@/components/product-state";
import { ProductMeta } from "@/components/product-meta";
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

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Terminal observations and forecasts</p>
        <h1 className="mt-1 font-heading text-3xl">{station?.city ?? icao} METAR and TAF</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Live products from the NOAA Aviation Weather Center. Chilean aerodromes file through the international
          OPMET exchange; if AWC has a gap, the desk falls back to a clearly marked mock so you can still brief.
        </p>
      </div>

      {metar.data ? (
        <div className="space-y-2">
          <ProductMeta envelope={metar} />
          <MetarPanel metar={metar.data} />
        </div>
      ) : (
        <ProductEmpty title="No METAR" body="That ICAO is not in the observation circuit right now." />
      )}

      {taf.data ? (
        <div className="space-y-2">
          <ProductMeta envelope={taf} />
          <TafPanel taf={taf.data} />
        </div>
      ) : (
        <ProductEmpty title="No TAF" body="Not every strip gets a terminal forecast. Try SCEL or SCFA." />
      )}
    </div>
  );
}
