import { productResponse } from "@/lib/api";
import { SYNOPTIC_PRODUCTS } from "@/lib/synoptic";
import { nowIso } from "@/lib/http";
import type { ProductEnvelope, SynopticProduct } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const envelope: ProductEnvelope<SynopticProduct[]> = {
    data: SYNOPTIC_PRODUCTS,
    source: "live",
    sourceLabel: "NOAA WPC International Desk charts (proxied)",
    fetchedAt: nowIso(),
  };
  return productResponse(envelope);
}
