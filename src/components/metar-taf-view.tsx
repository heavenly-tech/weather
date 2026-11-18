import { MetarPanel, TafPanel } from "@/components/metar-taf-panels";
import { OfficialMetarPanel, OfficialTafPanel } from "@/components/official-dgac-panel";
import { ProductEmpty } from "@/components/product-state";
import { ProductMeta } from "@/components/product-meta";
import type { Station } from "@/lib/stations";
import type {
  MetarObservation,
  OfficialMetarProduct,
  OfficialTafProduct,
  ProductEnvelope,
  TafForecast,
} from "@/lib/types";

export function MetarTafView({
  station,
  icao,
  metar,
  taf,
  officialMetar,
  officialTaf,
}: {
  station: Station | undefined;
  icao: string;
  metar: ProductEnvelope<MetarObservation>;
  taf: ProductEnvelope<TafForecast>;
  officialMetar: OfficialMetarProduct | null;
  officialTaf: OfficialTafProduct | null;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Terminal observations and forecasts</p>
        <h1 className="mt-1 font-heading text-3xl">{station?.city ?? icao} METAR and TAF</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          AWC circuit products (left) sit beside DGAC IFIS official bulletins (right). Model-generated terminal
          products elsewhere on the desk stay labelled separately.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">METAR</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">WMO circuit (NOAA AWC)</p>
            {metar.data ? (
              <>
                <ProductMeta envelope={metar} />
                <MetarPanel metar={metar.data} />
              </>
            ) : (
              <ProductEmpty title="No METAR" body="That ICAO is not in the observation circuit right now." />
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Oficial DGAC (IFIS)</p>
            {officialMetar ? (
              <OfficialMetarPanel product={officialMetar} />
            ) : (
              <ProductEmpty title="Official METAR loading" body="Could not load DGAC IFIS METAR." />
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">TAF</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">WMO circuit (NOAA AWC)</p>
            {taf.data ? (
              <>
                <ProductMeta envelope={taf} />
                <TafPanel taf={taf.data} />
              </>
            ) : (
              <ProductEmpty title="No TAF" body="Not every strip gets a terminal forecast. Try SCEL or SCFA." />
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Oficial DGAC (IFIS)</p>
            {officialTaf ? (
              <OfficialTafPanel product={officialTaf} />
            ) : (
              <ProductEmpty title="Official TAF loading" body="Could not load DGAC IFIS TAF." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}