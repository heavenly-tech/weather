import type { CeilingCell } from "@/lib/andes/fetch-field";
import { ANDES_DOMAIN } from "@/lib/andes/domain";
import { ceilingCategoryFromFtAgl } from "@/lib/andes/ceiling";
import { staticFineElevations } from "@/lib/andes/elevation-static";

const M_TO_FT = 3.280839895;
const OBSC_EPS_M = 5;

const SUBDIV = Number(process.env.ANDES_RENDER_SUBDIV ?? 4);

type CoarseSample = {
  lat: number;
  lon: number;
  baseMslM: number | null;
  obscured: boolean;
  lowCloudUnresolved: boolean;
  /** Liquid precipitation rate (mm/h) at this coarse point, when the grid fetch has it. */
  precipMmH?: number | null;
};

/**
 * Isolated cells disappear under bilinear interpolation: a single low base is
 * dropped unless two corners agree, and a shower is averaged toward zero.
 * Inside the coarse-cell neighbourhood, keep the lowest cloud base and the
 * highest precipitation rate.
 */
export function neighbourhoodBaseAndPrecip(corners: Array<CoarseSample | null | undefined>): {
  baseMslM: number | null;
  precipMmH: number | null;
  lowCloudUnresolved: boolean;
} {
  const present = corners.filter((sample): sample is CoarseSample => sample != null);
  const bases = present.map((sample) => sample.baseMslM).filter((base): base is number => base != null);
  const precips = present
    .map((sample) => sample.precipMmH)
    .filter((rate): rate is number => rate != null && Number.isFinite(rate));
  return {
    baseMslM: bases.length ? Math.min(...bases) : null,
    precipMmH: precips.length ? Math.max(...precips) : null,
    lowCloudUnresolved: present.some((sample) => sample.lowCloudUnresolved),
  };
}

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

      const corners = [matrix[r0]?.[c0], matrix[r0]?.[c1], matrix[r1]?.[c0], matrix[r1]?.[c1]];
      const neighbourhood = neighbourhoodBaseAndPrecip(corners);
      const baseMslM = neighbourhood.baseMslM;
      const lowCloudUnresolved = neighbourhood.lowCloudUnresolved;

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
        precipMmH: neighbourhood.precipMmH,
      });
    }
  }

  return { cells: out, rows: fineRows, cols: fineCols };
}