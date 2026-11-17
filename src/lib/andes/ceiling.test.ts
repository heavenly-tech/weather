import { describe, expect, it } from "vitest";
import {
  BKN_CLOUD_COVER_PCT,
  ceilingCategoryFromFtAgl,
  ceilingFromHourly,
  interpolateCloudBaseMsl,
} from "@/lib/andes/ceiling";
import fixture from "../../../tests/fixtures/open-meteo-hourly.json";
import underground from "../../../tests/fixtures/underground-cloud-levels.json";

describe("ceilingFromHourly", () => {
  it("interpolates BKN crossing between levels", () => {
    const { baseMslM, method } = interpolateCloudBaseMsl(fixture.hourly, 0, 600, 1015);
    expect(method).toBe("interpolated");
    expect(baseMslM).toBeGreaterThan(700);
    expect(baseMslM).toBeLessThan(820);
  });

  it("ignores underground 1000/975 hPa artefacts (SCEL-like)", () => {
    const sample = ceilingFromHourly(underground.hourly, 0, 474);
    expect(sample.method).toBe("interpolated");
    expect(sample.cloudBaseMslM).toBeGreaterThan(850);
    expect(sample.cloudBaseMslM).toBeLessThan(1700);
    expect(sample.obscured).toBe(false);
  });

  it("ICON convective base is AMSL and does not add terrain", () => {
    const hourly = {
      time: ["2026-11-17T12:00"],
      surface_pressure: [955],
      convective_cloud_base: [1200],
      convective_cloud_cover: [80],
      cloud_cover_850hPa: [5],
      geopotential_height_850hPa: [1600],
      geopotential_height_925hPa: [900],
      cloud_cover_925hPa: [5],
    };
    const s = ceilingFromHourly(hourly, 0, 474);
    expect(s.cloudBaseMslM).toBe(1200);
    expect(s.ceilingFtAgl).toBeCloseTo((1200 - 474) * 3.280839895, 0);
  });

  it("obscured when base MSL at or below terrain", () => {
    const hourly = {
      time: ["t"],
      surface_pressure: [980],
      convective_cloud_base: [600],
      convective_cloud_cover: [80],
      cloud_cover_925hPa: [5],
      geopotential_height_925hPa: [1200],
    };
    const s = ceilingFromHourly(hourly, 0, 700);
    expect(s.obscured).toBe(true);
    expect(s.ceilingFtAgl).toBe(0);
  });

  it("maps FAA categories from ft AGL", () => {
    expect(BKN_CLOUD_COVER_PCT).toBe(62.5);
    expect(ceilingCategoryFromFtAgl(400)).toBe("LIFR");
    expect(ceilingCategoryFromFtAgl(800)).toBe("IFR");
    expect(ceilingCategoryFromFtAgl(2000)).toBe("MVFR");
    expect(ceilingCategoryFromFtAgl(4000)).toBe("VFR");
  });
});