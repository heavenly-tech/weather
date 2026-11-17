import { describe, expect, it } from "vitest";
import { ftMslToHpa, hpaToFtMsl, nearestPressureLevel } from "@/lib/andes/altitude";

describe("altitude picker linkage", () => {
  it("round-trips ISA pressure to feet within a band", () => {
    const hpa = 850;
    const ft = hpaToFtMsl(hpa);
    const back = ftMslToHpa(ft);
    expect(Math.abs(back - hpa)).toBeLessThanOrEqual(15);
  });

  it("snaps to known pressure levels", () => {
    expect(nearestPressureLevel(848)).toBe(850);
    expect(nearestPressureLevel(715)).toBe(700);
  });
});