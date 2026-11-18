/**
 * Run the TypeScript ceiling and regrid functions for a parity input.
 * `scripts/capture-ceiling-parity.ts` writes the JSON bytes; the vitest
 * harness reads the same inputs back and checks those bytes still match.
 */
import { ceilingFromHourly, interpolateCloudBaseMsl, surfacePressureHpa } from "../src/lib/andes/ceiling";
import { neighbourhoodBaseAndPrecip, refineCeilingGrid } from "../src/lib/andes/ceiling-regrid";
import type { AndesModelId } from "../src/lib/andes/models";
import { assertEstOnlyInTrailingRmk } from "../src/lib/andes/product-rmk";
import { assertModelTafFormat } from "../src/lib/andes/taf-format";
import { generateModelMetar } from "../src/lib/andes/wmo-metar";
import { generateModelTaf } from "../src/lib/andes/wmo-taf";

type Hourly = Parameters<typeof ceilingFromHourly>[0];

type Coarse = {
  lat: number;
  lon: number;
  baseMslM: number | null;
  obscured: boolean;
  lowCloudUnresolved: boolean;
  precipMmH?: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function revive(value: unknown): unknown {
  if (typeof value === "string") {
    if (value === "NaN") return Number.NaN;
    if (value === "Infinity") return Number.POSITIVE_INFINITY;
    if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
    return value;
  }
  if (Array.isArray(value)) return value.map(revive);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = revive(inner);
    return out;
  }
  return value;
}

function requiredNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`parity input missing ${key}`);
  }
  return value;
}

function requiredString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") throw new Error(`parity input missing ${key}`);
  return value;
}

function estResult(raw: string): { ok: true } | { ok: false; error: string } {
  try {
    assertEstOnlyInTrailingRmk(raw);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function asHourly(value: unknown): Hourly {
  if (!isRecord(value)) return {};
  return value as Hourly;
}

function asCoarse(value: unknown): Coarse {
  if (!isRecord(value)) throw new Error("coarse sample must be an object");
  return {
    lat: typeof value.lat === "number" ? value.lat : 0,
    lon: typeof value.lon === "number" ? value.lon : 0,
    baseMslM: typeof value.baseMslM === "number" ? value.baseMslM : null,
    obscured: value.obscured === true,
    lowCloudUnresolved: value.lowCloudUnresolved === true,
    precipMmH: typeof value.precipMmH === "number" ? value.precipMmH : null,
  };
}

export async function renderCeilingParity(raw: unknown): Promise<unknown> {
  const revived = revive(raw);
  if (!isRecord(revived)) throw new Error("parity input must be an object");
  if (revived.label !== "EXAMPLE" && revived.label !== "recorded") {
    throw new Error("parity input label must be EXAMPLE or recorded");
  }
  if (typeof revived.op !== "string") throw new Error("parity input missing op");
  const index = typeof revived.index === "number" ? revived.index : 0;
  const hourly = asHourly(revived.hourly);

  switch (revived.op) {
    case "surfacePressureHpa":
      return surfacePressureHpa(hourly, index, requiredNumber(revived, "terrainElevM"));
    case "interpolateCloudBaseMsl":
      return interpolateCloudBaseMsl(
        hourly,
        index,
        requiredNumber(revived, "terrainElevM"),
        requiredNumber(revived, "surfaceHpa")
      );
    case "ceilingFromHourly":
      return ceilingFromHourly(hourly, index, requiredNumber(revived, "terrainElevM"));
    case "neighbourhoodBaseAndPrecip": {
      if (!Array.isArray(revived.corners)) throw new Error("corners must be an array");
      const corners = revived.corners.map((corner) => (corner == null ? null : asCoarse(corner)));
      return neighbourhoodBaseAndPrecip(corners);
    }
    case "refineCeilingGrid": {
      if (!Array.isArray(revived.cells)) throw new Error("cells must be an array");
      return refineCeilingGrid(
        revived.cells.map((cell) => asCoarse(cell)),
        requiredNumber(revived, "rows"),
        requiredNumber(revived, "cols")
      );
    }
    case "generateModelMetar": {
      const result = generateModelMetar({
        icao: requiredString(revived, "icao"),
        elevM: requiredNumber(revived, "elevM"),
        model: requiredString(revived, "model") as AndesModelId,
        runTime: requiredString(revived, "runTime"),
        validTime: requiredString(revived, "validTime"),
        hourly,
        hourIndex: typeof revived.hourIndex === "number" ? revived.hourIndex : index,
      });
      return { raw: result.raw, est: estResult(result.raw) };
    }
    case "generateModelTaf": {
      const result = generateModelTaf({
        icao: requiredString(revived, "icao"),
        elevM: requiredNumber(revived, "elevM"),
        model: requiredString(revived, "model") as AndesModelId,
        runTime: requiredString(revived, "runTime"),
        hourly,
      });
      if ("error" in result) return { error: result.error };
      return { raw: result.raw, est: estResult(result.raw), format: assertModelTafFormat(result.raw) };
    }
    case "assertModelTafFormat":
      return assertModelTafFormat(requiredString(revived, "raw"));
    default:
      throw new Error(`unknown parity op ${revived.op}`);
  }
}
