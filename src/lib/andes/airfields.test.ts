import { describe, expect, it } from "vitest";
import { andesAirfield } from "@/lib/andes/airfields";
import { haversineKm } from "@/lib/geo";

describe("SCVH La Victoria de Chacabuco", () => {
  it("uses the AIP ARP, has no METAR, and sits about 26 NM north of SCTB", () => {
    const scvh = andesAirfield("SCVH");
    const sctb = andesAirfield("SCTB");
    expect(scvh).toBeDefined();
    expect(sctb).toBeDefined();
    if (!scvh || !sctb) return;
    expect(scvh.name).toMatch(/Chacabuco/);
    expect(scvh.name).not.toMatch(/heliport|Viña|coast/i);
    expect(scvh.lat).toBeCloseTo(-(33 + 3 / 60 + 3 / 3600), 6);
    expect(scvh.lon).toBeCloseTo(-(70 + 42 / 60 + 32 / 3600), 6);
    expect(scvh.elevM).toBe(652);
    expect(scvh.hasMetar).toBe(false);
    expect(scvh.nearestMetarIcao).toBeUndefined();
    const nm = haversineKm(scvh, sctb) / 1.852;
    expect(nm).toBeGreaterThan(24);
    expect(nm).toBeLessThan(28);
    expect(scvh.lat).toBeGreaterThan(sctb.lat);
  });
});
