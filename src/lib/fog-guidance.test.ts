import { describe, expect, it } from "vitest";
import { forecastHasFogGuidance, hourIsModelFog } from "./fog-guidance";

describe("forecast fog guidance", () => {
  it("matches an FG or BR token and ignores lookalikes", () => {
    expect(forecastHasFogGuidance("0800 FG BKN003")).toBe(true);
    expect(forecastHasFogGuidance("4000 BR NSC")).toBe(true);
    expect(forecastHasFogGuidance("FZFG")).toBe(true);
    expect(forecastHasFogGuidance("BKN003")).toBe(false);
    expect(forecastHasFogGuidance("BCFG")).toBe(false);
    expect(forecastHasFogGuidance("")).toBe(false);
  });

  it("treats WMO fog codes as model fog", () => {
    expect(hourIsModelFog(45)).toBe(true);
    expect(hourIsModelFog(48)).toBe(true);
    expect(hourIsModelFog(3)).toBe(false);
    expect(hourIsModelFog(null)).toBe(false);
  });
});
