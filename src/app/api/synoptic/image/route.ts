import { fetchBinary } from "@/lib/http";
import { synopticById } from "@/lib/synoptic";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "sam-12";
  const product = synopticById(id);
  if (!product) {
    return new Response("Unknown synoptic product", { status: 404 });
  }
  const result = await fetchBinary(product.origin);
  if (!result.ok) {
    return new Response(`Chart fetch failed: ${result.error}`, { status: 502 });
  }
  return new Response(result.body, {
    headers: {
      "content-type": result.contentType.includes("image") ? result.contentType : "image/gif",
      "cache-control": "public, max-age=300",
    },
  });
}
