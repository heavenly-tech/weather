import { NextResponse } from "next/server";
import { fetchCeilingGrid } from "@/lib/andes/fetch-field";
import { parseAndesModelId } from "@/lib/andes/models";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const model = parseAndesModelId(searchParams.get("model"));
  if (!model) return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  const validTime = searchParams.get("validTime") ?? undefined;
  const grid = await fetchCeilingGrid(model, validTime ?? undefined);
  return NextResponse.json(grid);
}