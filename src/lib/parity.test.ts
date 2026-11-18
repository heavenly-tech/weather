import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { renderCeilingParity } from "../../scripts/ceiling-parity-render";
import recordedEcmwf from "../../tests/fixtures/recorded/sctb-ecmwf-ifs025-2026-11-18.json";
import recordedGfs from "../../tests/fixtures/recorded/sctb-gfs-seamless-2026-11-18.json";
import recordedSctb from "../../tests/fixtures/recorded/sctb-icon-seamless-2026-11-18.json";

type ParityCase = {
  id: string;
  label: string;
  role?: string;
};

type ParityManifest = {
  label: string;
  cases: ParityCase[];
};

const fixtureRoot = path.resolve(process.cwd(), "server-rs/tests/fixtures/parity");
const manifest = JSON.parse(readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8")) as ParityManifest;

async function renderCase(id: string): Promise<Uint8Array> {
  if (id === "api-health") {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    return new Uint8Array(await response.arrayBuffer());
  }
  const input = JSON.parse(readFileSync(path.join(fixtureRoot, `${id}.input.json`), "utf8")) as unknown;
  const rendered = await renderCeilingParity(input);
  const text = JSON.stringify(rendered);
  if (text === undefined) throw new Error(`${id} rendered undefined`);
  return new Uint8Array(Buffer.from(text));
}

function assertSameBytes(id: string, actual: Buffer, expected: Buffer): void {
  if (actual.equals(expected)) return;
  const shared = Math.min(actual.length, expected.length);
  let mismatch = shared;
  for (let i = 0; i < shared; i++) {
    if (actual[i] !== expected[i]) {
      mismatch = i;
      break;
    }
  }
  const start = Math.max(0, mismatch - 80);
  throw new Error(
    `${id} differs at byte ${mismatch} (ts ${actual.length}, golden ${expected.length})\n` +
      ` ts: ${actual.subarray(start, mismatch + 80).toString("utf8")}\n` +
      ` golden: ${expected.subarray(start, mismatch + 80).toString("utf8")}`
  );
}

describe("TS vs Rust parity fixtures", () => {
  it("uses EXAMPLE data and recorded SCTB hours", () => {
    expect(manifest.label).toBe("EXAMPLE");
    expect(manifest.cases.length).toBeGreaterThan(0);
    expect(manifest.cases.some((entry) => entry.label === "recorded" && entry.role === "night")).toBe(true);
    expect(manifest.cases.some((entry) => entry.label === "recorded" && entry.role === "missing-field")).toBe(true);
    const recordedHourly: Record<string, unknown> = {
      "ceiling-sctb-night": recordedSctb.hourly,
      "ceiling-sctb-missing-field": recordedSctb.hourly,
      "metar-sctb-ecmwf-night": recordedEcmwf.hourly,
      "metar-sctb-ecmwf-missing-field": recordedEcmwf.hourly,
      "taf-sctb-ecmwf": recordedEcmwf.hourly,
      "metar-sctb-gfs": recordedGfs.hourly,
      "taf-sctb-gfs": recordedGfs.hourly,
    };
    for (const [id, hourly] of Object.entries(recordedHourly)) {
      const input = JSON.parse(readFileSync(path.join(fixtureRoot, `${id}.input.json`), "utf8")) as {
        hourly: unknown;
        label: string;
      };
      expect(input.label).toBe("recorded");
      expect(input.hourly).toEqual(hourly);
    }
  });

  for (const entry of manifest.cases) {
    it(`${entry.id} matches the captured body`, async () => {
      expect(["EXAMPLE", "recorded"]).toContain(entry.label);
      const actual = Buffer.from(await renderCase(entry.id));
      const expected = readFileSync(path.join(fixtureRoot, `${entry.id}.body`));
      assertSameBytes(entry.id, actual, expected);
    });
  }
});
