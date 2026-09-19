"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetarPanel } from "@/components/metar-taf-panels";
import { ProductEmpty, ProductError, ProductLoading } from "@/components/product-state";
import { SourceBadge } from "@/components/source-badge";
import { useProduct } from "@/hooks/use-product";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import { flightCategoryBg, formatWind } from "@/lib/format";
import type { MetarObservation, TafForecast } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  const search = useSearchParams();
  const icao = (search.get("icao") ?? DEFAULT_ICAO).toUpperCase();
  const station = getStation(icao);
  const metar = useProduct<MetarObservation>(`/api/metar?icao=${icao}`);
  const taf = useProduct<TafForecast>(`/api/taf?icao=${icao}`);

  return (
    <div className="space-y-6">
      <div className="max-w-3xl space-y-2">
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Santiago FIR and the long coast</p>
        <h1 className="font-heading text-3xl tracking-tight md:text-4xl">
          Brief {station?.city ?? icao} before you walk out to the aircraft.
        </h1>
        <p className="text-muted-foreground">
          Heavenly Weather is a Chile-first aviation desk: live METAR and TAF from the NOAA Aviation Weather
          Center, a GRAMET-style route sounding, a GAMET-style FIR bulletin, WRF/GFS point forecasts, South
          American synoptic charts, and a 3D field of Chilean aerodromes. There is no login.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link className={buttonVariants()} href={`/metar-taf?icao=${icao}`}>
          Open METAR / TAF
        </Link>
        <Link className={buttonVariants({ variant: "outline" })} href={`/gramet?icao=${icao}&from=${icao}&to=SCTE`}>
          Route GRAMET
        </Link>
        <Link className={buttonVariants({ variant: "outline" })} href={`/viz?icao=${icao}`}>
          3D field
        </Link>
      </div>

      {metar.status === "loading" ? <ProductLoading /> : null}
      {metar.status === "empty" ? (
        <ProductEmpty
          title="No observation for that aerodrome"
          body="Pick a Chilean ICAO such as SCEL, SCFA, or SCCI. Some private strips never file a METAR."
        />
      ) : null}
      {metar.status === "error" ? (
        <ProductError title="METAR circuit failed" body={metar.message} />
      ) : null}
      {metar.status === "ready" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={metar.envelope.source} label={metar.envelope.sourceLabel} />
            {metar.envelope.warning ? (
              <span className="text-xs text-amber-200">{metar.envelope.warning}</span>
            ) : null}
          </div>
          <MetarPanel metar={metar.envelope.data} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Wind</CardTitle>
              </CardHeader>
              <CardContent>
                {formatWind(
                  metar.envelope.data.windDirDeg,
                  metar.envelope.data.windKt,
                  metar.envelope.data.gustKt
                )}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Flight category</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge className={flightCategoryBg(metar.envelope.data.flightCategory)} variant="outline">
                  {metar.envelope.data.flightCategory}
                </Badge>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>TAF snapshot</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {taf.status === "ready"
                  ? `${taf.envelope.data.periods.length} decoded periods · ${taf.envelope.source}`
                  : "Loading TAF…"}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
