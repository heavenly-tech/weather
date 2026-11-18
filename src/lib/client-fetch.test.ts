import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clientFetch } from "./client-fetch";

describe("clientFetch", () => {
  it("a 502 JSON response takes the error path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "model down" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        })
      )
    );
    await expect(clientFetch("/api/forecast?icao=SCTB")).rejects.toThrow("model down");
    vi.unstubAllGlobals();
  });

  it("returns the JSON body when the response is ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );
    await expect(clientFetch<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
    vi.unstubAllGlobals();
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

it("no raw fetch remains in the client outside the helper", () => {
  const roots = ["src/components", "src/client", "src/app"].map((dir) => path.resolve(dir));
  const hits: string[] = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (file.includes(`${path.sep}api${path.sep}`)) continue;
      const text = readFileSync(file, "utf8");
      if (/\bfetch\s*\(/.test(text)) hits.push(path.relative(process.cwd(), file));
    }
  }
  expect(hits).toEqual([]);
});
