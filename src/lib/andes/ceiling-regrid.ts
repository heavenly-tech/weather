import type { CeilingCell } from "@/lib/andes/fetch-field";
import { ANDES_DOMAIN } from "@/lib/andes/domain";
import { ceilingCategoryFromFtAgl } from "@/lib/andes/ceiling";
import { elevationsForPoints } from "@/lib/andes/elevation-cache";

const M_TO_FT = 3.280839895;
const OBSC_EPS_M = 5;

/** Factor N: N×N fine pixels per coarse model cell (~sub-km after coarse 0.25° grid). */
const SUBDIV = Number(process.env.ANDES_RENDER_SUBDIV ?? 4);

function bilinear(
  q11: number,
  q21: number,
  q12: number,
  q22: number,
  tx: number,
  ty: number
): number {
  const a = q11 * (1 - tx) + q21 * tx;
  const b = q12 * (1 - tx) + q22 * tx;
  return a * (1 - ty) + b * ty;
}

type CoarseSample = {
  lat: number;
  lon: number;
  baseMslM: number | null;
  obscured: boolean;
  lowCloudUnresolved: boolean;
};

function buildCoarseMatrix(
  cells: CoarseSample[],
  rows: number,
  cols: number
): (CoarseSample | null)[][] {
  const m: (CoarseSample | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null)
  );
  cells.forEach((c, i) => {
    const ri = Math.floor(i / cols);
    const ci = i % cols;
    if (ri < rows && ci < cols) m[ri]![ci] = c;
  });
  return m;
}

export async function refineCeilingGrid(
  coarseCells: CoarseSample[],
  coarseRows: number,
  coarseCols: number
): Promise<{ cells: CeilingCell[]; rows: number; cols: number }> {
  const fineRows = coarseRows * SUBDIV;
  const fineCols = coarseCols * SUBDIV;
  const matrix = buildCoarseMatrix(coarseCells, coarseRows, coarseCols);

  const finePoints: { lat: number; lon: number }[] = [];
  for (let fr = 0; fr < fineRows; fr++) {
    const lat =
      ANDES_DOMAIN.latMax +
      (fr / Math.max(1, fineRows - 1)) * (ANDES_DOMAIN.latMin - ANDES_DOMAIN.latMax);
    for (let fc = 0; fc < fineCols; fc++) {
      const lon =
        ANDES_DOMAIN.lonMin +
        (fc / Math.max(1, fineCols - 1)) * (ANDES_DOMAIN.lonMax - ANDES_DOMAIN.lonMin);
      finePoints.push({ lat, lon });
    }
  }

  const elevs = await elevationsForPoints(finePoints);
  const out: CeilingCell[] = [];

  for (let fr = 0; fr < fineRows; fr++) {
    for (let fc = 0; fc < fineCols; fc++) {
      const idx = fr * fineCols + fc;
      const p = finePoints[idx]!;
      const elevM = elevs[idx] ?? 0;

      const gr = (fr / Math.max(1, fineRows - 1)) * (coarseRows - 1);
      const gc = (fc / Math.max(1, fineCols - 1)) * (coarseCols - 1);
      const r0 = Math.floor(gr);
      const c0 = Math.floor(gc);
      const r1 = Math.min(coarseRows - 1, r0 + 1);
      const c1 = Math.min(coarseCols - 1, c0 + 1);
      const ty = gr - r0;
      const tx = gc - c0;

      const samples = [matrix[r0]?.[c0], matrix[r0]?.[c1], matrix[r1]?.[c0], matrix[r1]?.[c1]];
      const bases = samples.map((s) => s?.baseMslM);
      const allNull = bases.every((b) => b == null);

      let baseMslM: number | null = null;
      let lowCloudUnresolved = samples.some((s) => s?.lowCloudUnresolved);
      if (!allNull) {
        const v11 = bases[0] ?? bases[1] ?? bases[2] ?? bases[3];
        const v21 = bases[1] ?? bases[0];
        const v12 = bases[2] ?? bases[0];
        const v22 = bases[3] ?? bases[1] ?? bases[2] ?? bases[0];
        if (v11 != null && v21 != null && v12 != null && v22 != null) {
          baseMslM = bilinear(v11, v21, v12, v22, tx, ty);
        } else {
          const pick = samples.find((s) => s?.baseMslM != null);
          baseMslM = pick?.baseMslM ?? null;
        }
      }

      let ceilingFtAgl: number | null = null;
      let obscured = false;
      if (baseMslM != null) {
        obscured = baseMslM <= elevM + OBSC_EPS_M;
        const agl = baseMslM - elevM;
        ceilingFtAgl = agl > 0 ? agl * M_TO_FT : obscured ? null : null;
      }

      const category = ceilingCategoryFromFtAgl(ceilingFtAgl, null);
      out.push({
        lat: p.lat,
        lon: p.lon,
        elevM,
        ceilingFtAgl,
        category,
        obscured,
        cloudBaseMslM: baseMslM,
        lowCloudUnresolved: lowCloudUnresolved && ceilingFtAgl == null,
      });
    }
  }

  return { cells: out, rows: fineRows, cols: fineCols };
}