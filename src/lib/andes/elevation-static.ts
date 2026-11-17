import fs from "node:fs";
import path from "node:path";
import { ANDES_DOMAIN } from "@/lib/andes/domain";

const SUBDIV = Number(process.env.ANDES_RENDER_SUBDIV ?? 4);

export type FineGridSpec = { fineRows: number; fineCols: number; subdiv: number };

export function fineGridSpec(coarseRows: number, coarseCols: number): FineGridSpec {
  return {
    fineRows: coarseRows * SUBDIV,
    fineCols: coarseCols * SUBDIV,
    subdiv: SUBDIV,
  };
}

export function fineGridPoints(spec: FineGridSpec): { lat: number; lon: number }[] {
  const points: { lat: number; lon: number }[] = [];
  for (let fr = 0; fr < spec.fineRows; fr++) {
    const lat =
      ANDES_DOMAIN.latMax +
      (fr / Math.max(1, spec.fineRows - 1)) * (ANDES_DOMAIN.latMin - ANDES_DOMAIN.latMax);
    for (let fc = 0; fc < spec.fineCols; fc++) {
      const lon =
        ANDES_DOMAIN.lonMin +
        (fc / Math.max(1, spec.fineCols - 1)) * (ANDES_DOMAIN.lonMax - ANDES_DOMAIN.lonMin);
      points.push({ lat, lon });
    }
  }
  return points;
}

type ElevBlob = {
  coarseRows: number;
  coarseCols: number;
  subdiv: number;
  elevations: number[];
};

let cached: ElevBlob | null = null;

function loadBlob(): ElevBlob {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "andes-fine-elevation.json");
  cached = JSON.parse(fs.readFileSync(file, "utf8")) as ElevBlob;
  return cached;
}

export function staticFineElevations(coarseRows: number, coarseCols: number): number[] | null {
  const spec = fineGridSpec(coarseRows, coarseCols);
  const blob = loadBlob();
  if (blob.coarseRows !== coarseRows || blob.coarseCols !== coarseCols || blob.subdiv !== SUBDIV) {
    return null;
  }
  if (blob.elevations.length !== spec.fineRows * spec.fineCols) return null;
  return blob.elevations;
}