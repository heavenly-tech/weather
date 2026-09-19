import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetarPanel } from "@/components/metar-taf-panels";
import { ProductEmpty } from "@/components/product-state";
import { ProductMeta } from "@/components/product-meta";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import { flightCategoryBg, formatWind } from "@/lib/format";
import { loadMetar, loadTaf, normalizeIcao } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function HomePage({
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

      {!metar.data ? (
        <ProductEmpty
          title="No observation for that aerodrome"
          body="Pick a Chilean ICAO such as SCEL, SCFA, or SCCI. Some private strips never file a METAR."
        />
      ) : (
        <div className="space-y-3">
          <ProductMeta envelope={metar} />
          <MetarPanel metar={metar.data} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Wind</CardTitle>
              </CardHeader>
              <CardContent>
                {formatWind(metar.data.windDirDeg, metar.data.windKt, metar.data.gustKt)}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Flight category</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge className={flightCategoryBg(metar.data.flightCategory)} variant="outline">
                  {metar.data.flightCategory}
                </Badge>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>TAF snapshot</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {taf.data
                  ? `${taf.data.periods.length} decoded periods · ${taf.source}`
                  : "No TAF on file."}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
