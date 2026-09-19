import { icaoParam, productResponse } from "@/lib/api";
import { loadForecast } from "@/lib/products";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return productResponse(await loadForecast(icaoParam(request)));
}
