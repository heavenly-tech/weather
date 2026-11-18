import { describe, expect, it } from "vitest";
import { formatCloudBases } from "./format";

describe("formatCloudBases", () => {
  it("renders a TAF TEMPO cloud group in feet", () => {
    expect(
      formatCloudBases([
        { cover: "SCT", baseFt: 8000 },
        { cover: "BKN", baseFt: 20000 },
      ])
    ).toBe("SCT 8000 ft, BKN 20000 ft");
  });

  it("keeps a cover that has no base", () => {
    expect(formatCloudBases([{ cover: "NSC", baseFt: null }])).toBe("NSC");
  });
});
