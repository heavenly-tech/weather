/**
 * One-off: fetch fine grid elevations from Open-Meteo and write data/andes-fine-elevation.json
 * Run: npx tsx scripts/generate-andes-elevation.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { defaultGridShape } from "../src/lib/andes/domain";
import { fineGridPoints, fineGridSpec } from "../src/lib/andes/elevation-static";

async function main() {
  const { rows, cols } = defaultGridShape();
  const spec = fineGridSpec(rows, cols);
  const points = fineGridPoints(spec);
  const elevations: number[] = [];
  const BATCH = 100;
  for (let i = 0; i < points.length; i += BATCH) {
    const chunk = points.slice(i, i + BATCH);
    const params = new URLSearchParams({
      latitude: chunk.map((p) => p.lat.toFixed(4)).join(","),
      longitude: chunk.map((p) => p.lon.toFixed(4)).join(","),
    });
    const url = `https://api.open-meteo.com/v1/elevation?${params}`;
    let res = await fetch(url);
    for (let attempt = 0; res.status === 429 && attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      res = await fetch(url);
    }
    if (!res.ok) throw new Error(`elevation HTTP ${res.status}`);
    const body = (await res.json()) as { elevation: number[] };
    elevations.push(...body.elevation);
    await new Promise((r) => setTimeout(r, 800));
  }

  const out = {
    coarseRows: rows,
    coarseCols: cols,
    subdiv: spec.subdiv,
    generatedAt: new Date().toISOString(),
    elevations,
  };
  const outPath = path.join(process.cwd(), "data", "andes-fine-elevation.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out));
  console.log("Wrote", outPath, elevations.length, "points");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});