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
          OPMET exchange. If the center is unreachable or the report cannot be read, the desk says observations
          are unavailable. It does not fill the gap with a made-up METAR or TAF.
        </p>
      </div>

      {metar.data ? (
        <div className="space-y-2">
          <ProductMeta envelope={metar} />
          <MetarPanel metar={metar.data} />
        </div>
      ) : (
        <ProductEmpty
          title={metar.source === "unavailable" ? "Observations unavailable" : "No METAR"}
          body={
            metar.source === "unavailable"
              ? "The Aviation Weather Center did not return a usable METAR. This page is not showing a stand-in observation."
              : "That ICAO is not in the observation circuit right now."
          }
        />
      )}

      {taf.data ? (
        <div className="space-y-2">
          <ProductMeta envelope={taf} />
          <TafPanel taf={taf.data} />
        </div>
      ) : (
        <ProductEmpty
          title={taf.source === "unavailable" ? "Observations unavailable" : "No TAF"}
          body={
            taf.source === "unavailable"
              ? "The Aviation Weather Center did not return a usable TAF. This page is not showing a stand-in forecast."
              : "Not every strip gets a terminal forecast. Try SCEL or SCFA."
          }
        />
      )}
    </div>
  );
}
