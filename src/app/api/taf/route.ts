import { icaoParam, productResponse } from "@/lib/api";
import { loadTaf } from "@/lib/products";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return productResponse(await loadTaf(icaoParam(request)));
}
