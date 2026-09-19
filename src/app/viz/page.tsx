"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { ProductEmpty, ProductError, ProductLoading } from "@/components/product-state";
import { SourceBadge } from "@/components/source-badge";
import { useProduct } from "@/hooks/use-product";
import { DEFAULT_ICAO } from "@/lib/stations";
import type { VizStation } from "@/lib/types";
import { flightCategoryBg, formatTemp, formatWind } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

const WeatherScene = dynamic(
  () => import("@/components/weather-scene").then((m) => m.WeatherScene),
  {
    ssr: false,
    loading: () => <ProductLoading rows={2} />,
  }
);

export default function VizPage() {
  const search = useSearchParams();
  const icao = (search.get("icao") ?? DEFAULT_ICAO).toUpperCase();
  const product = useProduct<VizStation[]>(`/api/viz?icao=${icao}`);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Chile weather field</p>
        <h1 className="mt-1 font-heading text-3xl">3D visualization</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Cesium globe over Chile. Drag to orbit. Columns are aerodromes colored by METAR flight category;
          height mixes elevation and cloud cover. The selected station also shows a GFS wind column. Tiles
          are OpenStreetMap (no Cesium ion token required). This is a briefing sketch, not a certified SIGWX
          display.
        </p>
      </div>

      {product.status === "loading" ? <ProductLoading rows={3} /> : null}
      {product.status === "empty" ? (
        <ProductEmpty title="No field to plot" body="The visualization API returned no stations." />
      ) : null}
      {product.status === "error" ? <ProductError title="3D field failed" body={product.message} /> : null}
      {product.status === "ready" ? (
        <div className="space-y-4">
          <SourceBadge source={product.envelope.source} label={product.envelope.sourceLabel} />
          {product.envelope.warning ? <p className="text-xs text-amber-200">{product.envelope.warning}</p> : null}
          <WeatherScene stations={product.envelope.data} focusIcao={icao} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {product.envelope.data.map((station) => (
              <div key={station.icao} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <div>
                  <p className="font-mono text-primary">{station.icao}</p>
                  <p className="text-xs text-muted-foreground">
                    {station.name} · {formatTemp(station.tempC)} · {formatWind(station.windDirDeg, station.windKt)}
                  </p>
                </div>
                <Badge className={flightCategoryBg(station.flightCategory)} variant="outline">
                  {station.flightCategory}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
