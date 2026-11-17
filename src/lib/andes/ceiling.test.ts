import { describe, expect, it } from "vitest";
import {
  BKN_CLOUD_COVER_PCT,
  ceilingCategoryFromFtAgl,
  ceilingFromHourly,
  interpolateCloudBaseMsl,
} from "@/lib/andes/ceiling";
import fixture from "../../../tests/fixtures/open-meteo-hourly.json";
import underground from "../../../tests/fixtures/underground-cloud-levels.json";
import iconFixture from "../../../tests/fixtures/icon-scel-hour.json";

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
    expect(sample.obscured).toBe(false);
  });

  it("no ceiling when low cloud >=50% but no BKN level", () => {
    const hourly = {
      time: ["t"],
      surface_pressure: [990],
      cloud_cover_low: [55],
      cloud_cover_925hPa: [40],
      geopotential_height_925hPa: [1200],
      cloud_cover_850hPa: [30],
      geopotential_height_850hPa: [1600],
    };
    const s = ceilingFromHourly(hourly, 0, 474);
    expect(s.ceilingFtAgl).toBeNull();
    expect(s.lowCloudUnresolved).toBe(true);
    expect(s.ceilingCategory).not.toBe("LIFR");
  });

  it("first moist level 140m AGL is interpolated, not obscured", () => {
    const hourly = {
      time: ["t"],
      surface_pressure: [980],
      cloud_cover_925hPa: [80],
      geopotential_height_925hPa: [480 + 140],
      cloud_cover_850hPa: [20],
      geopotential_height_850hPa: [1600],
    };
    const s = ceilingFromHourly(hourly, 0, 480);
    expect(s.ceilingFtAgl).toBeGreaterThan(100);
    expect(s.obscured).toBe(false);
  });

  it("ICON convective base ignored without convective_cloud_cover", () => {
    const hourly = {
      time: ["t"],
      surface_pressure: [955],
      convective_cloud_base: [1200],
      cloud_cover_850hPa: [5],
      geopotential_height_850hPa: [1600],
    };
    const s = ceilingFromHourly(hourly, 0, 474);
    expect(s.cloudBaseMslM).not.toBe(1200);
  });

  it("ICON convective base used when cover is BKN+ (fixture)", () => {
    const idx = 0;
    const elev = iconFixture.elevation ?? 474;
    const s = ceilingFromHourly(iconFixture.hourly, idx, elev);
    const cc = (iconFixture.hourly.convective_cloud_cover as number[])[idx];
    const cb = (iconFixture.hourly.convective_cloud_base as number[])[idx];
    if (cc != null && cc >= 62.5 && cb != null && cb > 0) {
      expect(s.cloudBaseMslM).toBe(cb);
    }
  });

  it("maps FAA categories from ft AGL", () => {
    expect(BKN_CLOUD_COVER_PCT).toBe(62.5);
    expect(ceilingCategoryFromFtAgl(400)).toBe("LIFR");
    expect(ceilingCategoryFromFtAgl(800)).toBe("IFR");
    expect(ceilingCategoryFromFtAgl(2000)).toBe("MVFR");
    expect(ceilingCategoryFromFtAgl(4000)).toBe("VFR");
  });
});