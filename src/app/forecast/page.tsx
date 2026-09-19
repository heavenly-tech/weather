"use client";

import { useSearchParams } from "next/navigation";
import { Meteogram } from "@/components/meteogram";
import { ProductEmpty, ProductError, ProductLoading } from "@/components/product-state";
import { SourceBadge } from "@/components/source-badge";
import { useProduct } from "@/hooks/use-product";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import type { PointForecast } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ForecastPage() {
  const search = useSearchParams();
  const icao = (search.get("icao") ?? DEFAULT_ICAO).toUpperCase();
  const station = getStation(icao);
  const product = useProduct<PointForecast>(`/api/forecast?icao=${icao}`);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Point forecast</p>
        <h1 className="mt-1 font-heading text-3xl">{station?.city ?? icao} WRF / GFS</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          MeteoChile WRF-DMC is the operational regional model nested from GFS. Their HTTP product needs a
          personal token. If <span className="font-mono">METEOCHILE_USER</span> and{" "}
          <span className="font-mono">METEOCHILE_TOKEN</span> are set, this page uses WRF-DMC. Otherwise it
          uses live Open-Meteo GFS at the aerodrome — the same parent model — and says so.
        </p>
      </div>

      {product.status === "loading" ? <ProductLoading /> : null}
      {product.status === "empty" ? (
        <ProductEmpty title="No forecast series" body="The model grid did not return a time series for that point." />
      ) : null}
      {product.status === "error" ? <ProductError title="Forecast failed" body={product.message} /> : null}
      {product.status === "ready" ? (
        <div className="space-y-3">
          <SourceBadge source={product.envelope.source} label={product.envelope.sourceLabel} />
          {product.envelope.warning ? <p className="text-xs text-amber-200">{product.envelope.warning}</p> : null}
          <Card>
            <CardHeader>
              <CardTitle>
                {product.envelope.data.model} · {product.envelope.data.hours.length} hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Meteogram forecast={product.envelope.data} />
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
