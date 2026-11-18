import { MetarPanel, TafPanel } from "@/components/metar-taf-panels";
import { ProductEmpty } from "@/components/product-state";
import { ProductMeta } from "@/components/product-meta";
import type { Station } from "@/lib/stations";
import type { MetarObservation, ProductEnvelope, TafForecast } from "@/lib/types";

export function MetarTafView({
  station,
  icao,
  metar,
  taf,
}: {
  station: Station | undefined;
  icao: string;
  metar: ProductEnvelope<MetarObservation>;
  taf: ProductEnvelope<TafForecast>;
}) {
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
