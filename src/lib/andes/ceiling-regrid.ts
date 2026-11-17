import type { CeilingCell } from "@/lib/andes/fetch-field";
import { ANDES_DOMAIN } from "@/lib/andes/domain";
import { ceilingCategoryFromFtAgl } from "@/lib/andes/ceiling";
import { staticFineElevations } from "@/lib/andes/elevation-static";

const M_TO_FT = 3.280839895;
const OBSC_EPS_M = 5;

const SUBDIV = Number(process.env.ANDES_RENDER_SUBDIV ?? 4);

function bilinear(q11: number, q21: number, q12: number, q22: number, tx: number, ty: number): number {
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

  const elevs = staticFineElevations(coarseRows, coarseCols);
  if (!elevs || elevs.length !== fineRows * fineCols) {
    throw new Error("Static fine elevation grid missing — run scripts/generate-andes-elevation.ts");
  }

  const out: CeilingCell[] = [];

  for (let fr = 0; fr < fineRows; fr++) {
    const lat =
      ANDES_DOMAIN.latMax +
      (fr / Math.max(1, fineRows - 1)) * (ANDES_DOMAIN.latMin - ANDES_DOMAIN.latMax);
    for (let fc = 0; fc < fineCols; fc++) {
      const lon =
        ANDES_DOMAIN.lonMin +
        (fc / Math.max(1, fineCols - 1)) * (ANDES_DOMAIN.lonMax - ANDES_DOMAIN.lonMin);
      const idx = fr * fineCols + fc;
      const elevM = elevs[idx];
      if (elevM == null || !Number.isFinite(elevM)) {
        out.push({
          lat,
          lon,
          elevM: 0,
          ceilingFtAgl: null,
          category: "UNK",
          obscured: false,
          cloudBaseMslM: null,
          lowCloudUnresolved: true,
        });
        continue;
      }

      const gr = (fr / Math.max(1, fineRows - 1)) * (coarseRows - 1);
      const gc = (fc / Math.max(1, fineCols - 1)) * (coarseCols - 1);
      const r0 = Math.floor(gr);
      const c0 = Math.floor(gc);
      const r1 = Math.min(coarseRows - 1, r0 + 1);
      const c1 = Math.min(coarseCols - 1, c0 + 1);
      const ty = gr - r0;
      const tx = gc - c0;

      const corners = [matrix[r0]?.[c0], matrix[r0]?.[c1], matrix[r1]?.[c0], matrix[r1]?.[c1]];
      const present = corners.filter((s) => s?.baseMslM != null);
      const lowCloudUnresolved = corners.some((s) => s?.lowCloudUnresolved);

      let baseMslM: number | null = null;
      if (present.length === 4) {
        const v11 = corners[0]!.baseMslM!;
        const v21 = corners[1]!.baseMslM!;
        const v12 = corners[2]!.baseMslM!;
        const v22 = corners[3]!.baseMslM!;
        baseMslM = bilinear(v11, v21, v12, v22, tx, ty);
      } else if (present.length >= 2) {
        const nearest = corners.reduce<{ d: number; b: number } | null>((best, s, ci) => {
          if (s?.baseMslM == null) return best;
          const dist = (ci % 2 === 0 ? tx : 1 - tx) + (ci < 2 ? ty : 1 - ty);
          if (!best || dist < best.d) return { d: dist, b: s.baseMslM };
          return best;
        }, null);
        baseMslM = nearest?.b ?? null;
      }

      let ceilingFtAgl: number | null = null;
      let obscured = false;
      if (baseMslM != null) {
        obscured = baseMslM <= elevM + OBSC_EPS_M;
        const agl = baseMslM - elevM;
        ceilingFtAgl = agl > 0 ? agl * M_TO_FT : null;
      }

      const category = lowCloudUnresolved && ceilingFtAgl == null ? "UNK" : ceilingCategoryFromFtAgl(ceilingFtAgl, null);
      out.push({
        lat,
        lon,
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