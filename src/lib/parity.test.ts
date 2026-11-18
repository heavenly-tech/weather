import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { renderCeilingParity } from "../../scripts/ceiling-parity-render";

type ParityCase = {
  id: string;
  label: string;
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
  it("uses EXAMPLE data", () => {
    expect(manifest.label).toBe("EXAMPLE");
    expect(manifest.cases.length).toBeGreaterThan(0);
  });

  for (const entry of manifest.cases) {
    it(`${entry.id} matches the captured body`, async () => {
      expect(entry.label).toBe("EXAMPLE");
      const actual = Buffer.from(await renderCase(entry.id));
      const expected = readFileSync(path.join(fixtureRoot, `${entry.id}.body`));
      assertSameBytes(entry.id, actual, expected);
    });
  }
});
