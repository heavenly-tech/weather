import { Meteogram } from "@/components/meteogram";
import { ProductEmpty } from "@/components/product-state";
import { ProductMeta } from "@/components/product-meta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_ICAO, getStation } from "@/lib/stations";
import { loadForecast, normalizeIcao } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const icao = normalizeIcao(params.icao, DEFAULT_ICAO);
  const station = getStation(icao);
  const product = await loadForecast(icao);

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

      {product.data ? (
        <div className="space-y-3">
          <ProductMeta envelope={product} />
          <Card>
            <CardHeader>
              <CardTitle>
                {product.data.model} · {product.data.hours.length} hours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Meteogram forecast={product.data} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <ProductEmpty title="No forecast series" body="The model grid did not return a time series for that point." />
      )}
    </div>
  );
}
