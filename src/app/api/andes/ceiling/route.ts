import { NextResponse } from "next/server";
import type { AndesModelId } from "@/lib/andes/models";
import { fetchCeilingGrid } from "@/lib/andes/fetch-field";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const model = (searchParams.get("model") ?? "gfs_seamless") as AndesModelId;
  const validTime = searchParams.get("validTime") ?? undefined;
  const grid = await fetchCeilingGrid(model, validTime ?? undefined);
  return NextResponse.json(grid);
}