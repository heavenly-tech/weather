import { buildGamet, parseFir } from "@/lib/gamet";
import { productResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fir = parseFir(url.searchParams.get("fir"));
  const envelope = await buildGamet(fir);
  return productResponse(envelope);
}
