import { icaoParam, productResponse } from "@/lib/api";
import { loadMetar } from "@/lib/products";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return productResponse(await loadMetar(icaoParam(request)));
}
