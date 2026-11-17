import { describe, expect, it } from "vitest";
import { BKN_CLOUD_COVER_PCT, ceilingFromHourly, ceilingCategoryFromFtAgl } from "@/lib/andes/ceiling";
import fixture from "../../../tests/fixtures/open-meteo-hourly.json";

describe("ceilingFromHourly", () => {
  it("uses BKN threshold on pressure-level cloud cover", () => {
    expect(BKN_CLOUD_COVER_PCT).toBe(62.5);
    const sample = ceilingFromHourly(fixture.hourly, 0, 600, null);
    expect(sample.method).toBe("pressure_level");
    expect(sample.ceilingFtAgl).not.toBeNull();
    expect(sample.ceilingFtAgl!).toBeGreaterThan(0);
  });

  it("returns unlimited when no moist layer", () => {
    const sample = ceilingFromHourly(fixture.hourly, 1, 600, null);
    expect(sample.method).toBe("unlimited");
    expect(sample.ceilingFtAgl).toBeNull();
  });

  it("maps FAA categories from ft AGL", () => {
    expect(ceilingCategoryFromFtAgl(400)).toBe("LIFR");
    expect(ceilingCategoryFromFtAgl(800)).toBe("IFR");
    expect(ceilingCategoryFromFtAgl(2000)).toBe("MVFR");
    expect(ceilingCategoryFromFtAgl(4000)).toBe("VFR");
  });
});