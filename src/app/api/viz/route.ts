import { icaoParam, productResponse } from "@/lib/api";
import { loadViz } from "@/lib/products";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return productResponse(await loadViz(icaoParam(request)));
}
