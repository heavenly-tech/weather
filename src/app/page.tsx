import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { MetarPanel, TafPanel } from "@/components/metar-taf-panels";
import { ProductEmpty } from "@/components/product-state";
import { ProductMeta } from "@/components/product-meta";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
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
        </div>
      )}

      {taf.data ? (
        <div className="space-y-3">
          <div>
            <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Terminal forecast</p>
            <h2 className="mt-1 font-heading text-xl">TAF {icao}</h2>
          </div>
          <ProductMeta envelope={taf} />
          <TafPanel taf={taf.data} />
        </div>
      ) : (
        <ProductEmpty
          title="No TAF"
          body="AWC did not return a terminal forecast for this aerodrome, and no fallback bulletin is on file. Try SCEL or SCFA."
        />
      )}
    </div>
  );
}
