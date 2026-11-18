import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

type ParityCase = {
  id: string;
  method: string;
  path: string;
  source: string;
  label: string;
};

type ParityManifest = {
  label: string;
  cases: ParityCase[];
};

const fixtureRoot = path.resolve(process.cwd(), "server-rs/tests/fixtures/parity");
const manifest = JSON.parse(readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8")) as ParityManifest;

const renderers: Record<string, () => Promise<Uint8Array>> = {
  "api-health": async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    return new Uint8Array(await response.arrayBuffer());
  },
};

describe("TS vs Rust parity fixtures", () => {
  it("uses EXAMPLE data", () => {
    expect(manifest.label).toBe("EXAMPLE");
    expect(manifest.cases.length).toBeGreaterThan(0);
  });

  for (const entry of manifest.cases) {
    it(`${entry.id} matches the captured body`, async () => {
      expect(entry.label).toBe("EXAMPLE");
      const render = renderers[entry.id];
      if (!render) {
        throw new Error(`add a TS renderer for ${entry.id}`);
      }
      const actual = Buffer.from(await render());
      const expected = readFileSync(path.join(fixtureRoot, `${entry.id}.body`));
      expect(actual.equals(expected), `${entry.id} bytes differ`).toBe(true);
    });
  }
});
