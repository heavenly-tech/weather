import { productResponse } from "@/lib/api";
import { loadSynoptic } from "@/lib/products";

export const dynamic = "force-dynamic";

export async function GET() {
  return productResponse(loadSynoptic());
}
