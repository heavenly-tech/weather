"use client";

import dynamic from "next/dynamic";
import { ProductEmpty, ProductLoading } from "@/components/product-state";
import { ProductMeta } from "@/components/product-meta";
import type { ProductEnvelope, VizStation } from "@/lib/types";
import { flightCategoryBg, formatTemp, formatWind } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

const WeatherScene = dynamic(
  () => import("@/components/weather-scene").then((m) => m.WeatherScene),
  {
    ssr: false,
    loading: () => <ProductLoading rows={2} />,
  }
);

export function VizDesk({
  icao,
  envelope,
}: {
  icao: string;
  envelope: ProductEnvelope<VizStation[]>;
}) {
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

      {envelope.data?.length ? (
        <div className="space-y-4">
          <ProductMeta envelope={envelope} />
          <WeatherScene stations={envelope.data} focusIcao={icao} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {envelope.data.map((station) => (
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
      ) : (
        <ProductEmpty title="No field to plot" body="The visualization API returned no stations." />
      )}
    </div>
  );
}
