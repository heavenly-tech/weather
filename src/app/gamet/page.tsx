"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductEmpty, ProductError, ProductLoading } from "@/components/product-state";
import { SourceBadge } from "@/components/source-badge";
import { useProduct } from "@/hooks/use-product";
import { FIRS, DEFAULT_ICAO, firForStation } from "@/lib/stations";
import type { GametBulletin } from "@/lib/types";
import { formatUtc } from "@/lib/format";

export default function GametPage() {
  const search = useSearchParams();
  const router = useRouter();
  const icao = (search.get("icao") ?? DEFAULT_ICAO).toUpperCase();
  const fir = (search.get("fir") ?? firForStation(icao)).toUpperCase();
  const product = useProduct<GametBulletin>(`/api/gamet?fir=${fir}`);

  function setFir(next: string) {
    const params = new URLSearchParams(search.toString());
    params.set("fir", next);
    router.replace(`/gamet?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] tracking-[0.28em] text-primary uppercase">Low-level area forecast</p>
        <h1 className="mt-1 font-heading text-3xl">GAMET</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          DGAC issues official GAMET on the OPMET/AFTN circuit, not a public JSON API. This page builds a
          GAMET-style bulletin from GFS and any international SIGMETs that intersect Chile, then labels it
          derived so it is never confused with the signed DMC product.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FIRS.map((item) => (
          <Button
            key={item.id}
            variant={item.id === fir ? "default" : "outline"}
            size="sm"
            onClick={() => setFir(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {product.status === "loading" ? <ProductLoading /> : null}
      {product.status === "empty" ? (
        <ProductEmpty title="No GAMET" body="Select a Chilean FIR." />
      ) : null}
      {product.status === "error" ? <ProductError title="GAMET failed" body={product.message} /> : null}
      {product.status === "ready" ? (
        <div className="space-y-3">
          <SourceBadge source={product.envelope.source} label={product.envelope.sourceLabel} />
          {product.envelope.warning ? <p className="text-xs text-amber-200">{product.envelope.warning}</p> : null}
          <p className="text-sm text-muted-foreground">
            Valid {formatUtc(product.envelope.data.validFrom)} → {formatUtc(product.envelope.data.validTo)}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {product.envelope.data.sections.map((section) => (
              <Card key={section.title}>
                <CardHeader>
                  <CardTitle>{section.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {section.lines.map((line) => (
                      <li key={line} className="wx-raw">
                        {line}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Raw bulletin</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="wx-raw whitespace-pre-wrap">{product.envelope.data.raw}</pre>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
