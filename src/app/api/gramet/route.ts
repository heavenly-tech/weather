import { buildGramet } from "@/lib/gramet";
import { productResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = (url.searchParams.get("from") ?? "SCEL").toUpperCase();
  const to = (url.searchParams.get("to") ?? "SCTE").toUpperCase();
  const envelope = await buildGramet(from, to);
  return productResponse(envelope);
}
