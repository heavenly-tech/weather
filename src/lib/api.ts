import { NextResponse } from "next/server";

export function productResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

export function icaoParam(request: Request, fallback = "SCEL"): string {
  const url = new URL(request.url);
  return (url.searchParams.get("icao") ?? url.searchParams.get("ids") ?? fallback)
    .split(",")[0]
    .trim()
    .toUpperCase();
}
