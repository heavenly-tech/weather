import { describe, expect, it } from "vitest";
import { neighbourhoodBaseAndPrecip, refineCeilingGrid } from "@/lib/andes/ceiling-regrid";

describe("neighbourhood regrid", () => {
  it("keeps the lowest base and the highest precip when only one corner has a cell", () => {
    const agg = neighbourhoodBaseAndPrecip([
      { lat: 1, lon: 1, baseMslM: 1500, obscured: false, lowCloudUnresolved: false, precipMmH: 4.2 },
      { lat: 1, lon: 2, baseMslM: null, obscured: false, lowCloudUnresolved: false, precipMmH: 0 },
      null,
      { lat: 2, lon: 2, baseMslM: 3200, obscured: false, lowCloudUnresolved: false, precipMmH: 0.1 },
    ]);
    expect(agg.baseMslM).toBe(1500);
    expect(agg.precipMmH).toBe(4.2);
  });

  it("does not drop an isolated ceiling inside the fine grid", async () => {
    const rows = 11;
    const cols = 8;
    const cells = Array.from({ length: rows * cols }, () => ({
      lat: 0,
      lon: 0,
      baseMslM: null as number | null,
      obscured: false,
      lowCloudUnresolved: false,
      precipMmH: 0,
    }));
    const isolated = 5 * cols + 3;
    cells[isolated] = { ...cells[isolated]!, baseMslM: 1800, precipMmH: 6 };
    const refined = await refineCeilingGrid(cells, rows, cols);
    const withBase = refined.cells.filter((cell) => cell.cloudBaseMslM === 1800);
    const withPrecip = refined.cells.filter((cell) => cell.precipMmH === 6);
    expect(withBase.length).toBeGreaterThan(0);
    expect(withPrecip.length).toBeGreaterThan(0);
    expect(withBase.length).toBeLessThan(refined.cells.length / 2);
  });
});
