import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OfficialDgacBadge } from "@/components/official-dgac-badge";
import { formatOfficialAge, formatUtc } from "@/lib/format";
import type { OfficialTafProduct, OfficialMetarProduct } from "@/lib/types";

function OfficialMeta({
  product,
  productName,
}: {
  product: OfficialMetarProduct | OfficialTafProduct;
  productName: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <OfficialDgacBadge stale={product.stale} unavailable={product.unavailable} />
      {product.unavailable ? (
        <span className="text-amber-200">{product.unavailableReason ?? "Official data unavailable"}</span>
      ) : (
        <>
          {product.issuedAt ? (
            <span className={product.stale ? "text-muted-foreground line-through" : "text-foreground"}>
              Issued {formatUtc(product.issuedAt)}
            </span>
          ) : null}
          {product.ageSeconds >= 0 ? (
            <span className={product.stale ? "font-medium text-amber-200" : "text-muted-foreground"}>
              {formatOfficialAge(product.ageSeconds)}
              {product.stale ? " · stale — not current" : ""}
            </span>
          ) : null}
        </>
      )}
      <a
        className="text-primary underline-offset-4 hover:underline"
        href={product.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        IFIS {productName} source
      </a>
    </div>
  );
}

export function OfficialMetarPanel({ product }: { product: OfficialMetarProduct }) {
  return (
    <Card className="border-sky-500/40 bg-sky-950/20">
      <CardHeader className="border-b border-sky-500/20">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="font-mono text-sky-200">{product.icao}</span>
          <span>Oficial DGAC METAR</span>
        </CardTitle>
        <OfficialMeta product={product} productName="METAR" />
      </CardHeader>
      <CardContent>
        {product.unavailable || !product.raw ? (
          <p className="text-sm text-muted-foreground">No official METAR available from DGAC IFIS for this station.</p>
        ) : (
          <pre
            className={`wx-raw rounded-lg p-3 ring-1 ring-sky-500/30 ${product.stale ? "bg-muted/50 text-muted-foreground" : "bg-background/60"}`}
          >
            {product.raw}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

export function OfficialTafPanel({ product }: { product: OfficialTafProduct }) {
  return (
    <Card className="border-sky-500/40 bg-sky-950/20">
      <CardHeader className="border-b border-sky-500/20">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="font-mono text-sky-200">{product.icao}</span>
          <span>Oficial DGAC TAF</span>
        </CardTitle>
        <OfficialMeta product={product} productName="TAF" />
      </CardHeader>
      <CardContent>
        {product.unavailable || !product.raw ? (
          <p className="text-sm text-muted-foreground">
            {product.unavailableReason === "no_taf_for_designator"
              ? "DGAC does not publish a TAF for this designator on IFIS."
              : "No official TAF available from DGAC IFIS right now."}
          </p>
        ) : (
          <pre
            className={`wx-raw rounded-lg p-3 ring-1 ring-sky-500/30 ${product.stale ? "bg-muted/50 text-muted-foreground" : "bg-background/60"}`}
          >
            {product.raw}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}