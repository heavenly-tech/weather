"use client";

import { useSearchParams } from "next/navigation";
import { MetarPanel, TafPanel } from "@/components/metar-taf-panels";
import { ProductEmpty, ProductError, ProductLoading } from "@/components/product-state";
import { SourceBadge } from "@/components/source-badge";
import { useProduct } from "@/hooks/use-product";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import type { MetarObservation, TafForecast } from "@/lib/types";

export default function MetarTafPage() {
  const search = useSearchParams();
  const icao = (search.get("icao") ?? DEFAULT_ICAO).toUpperCase();
  const station = getStation(icao);
  const metar = useProduct<MetarObservation>(`/api/metar?icao=${icao}`);
  const taf = useProduct<TafForecast>(`/api/taf?icao=${icao}`);

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

      {metar.status === "loading" ? <ProductLoading /> : null}
      {metar.status === "empty" ? (
        <ProductEmpty title="No METAR" body="That ICAO is not in the observation circuit right now." />
      ) : null}
      {metar.status === "error" ? <ProductError title="METAR failed" body={metar.message} /> : null}
      {metar.status === "ready" ? (
        <div className="space-y-2">
          <SourceBadge source={metar.envelope.source} label={metar.envelope.sourceLabel} />
          {metar.envelope.warning ? <p className="text-xs text-amber-200">{metar.envelope.warning}</p> : null}
          <MetarPanel metar={metar.envelope.data} />
        </div>
      ) : null}

      {taf.status === "loading" ? <ProductLoading rows={3} /> : null}
      {taf.status === "empty" ? (
        <ProductEmpty title="No TAF" body="Not every strip gets a terminal forecast. Try SCEL or SCFA." />
      ) : null}
      {taf.status === "error" ? <ProductError title="TAF failed" body={taf.message} /> : null}
      {taf.status === "ready" ? (
        <div className="space-y-2">
          <SourceBadge source={taf.envelope.source} label={taf.envelope.sourceLabel} />
          {taf.envelope.warning ? <p className="text-xs text-amber-200">{taf.envelope.warning}</p> : null}
          <TafPanel taf={taf.envelope.data} />
        </div>
      ) : null}
    </div>
  );
}
