import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedFetchUrl, clearOpenMeteoCache } from "@/lib/andes/open-meteo-cache";

describe("Open-Meteo cache", () => {
  afterEach(() => {
    clearOpenMeteoCache();
    vi.unstubAllGlobals();
  });

  it("dedupes in-flight calls and then serves the same URL from cache", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ hourly: { time: ["t"] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
    const url = "https://api.open-meteo.com/v1/forecast?latitude=-33.46&longitude=-70.55&models=gfs_seamless&hourly=temperature_2m";
    const [a, b] = await Promise.all([cachedFetchUrl(url, "gfs_seamless"), cachedFetchUrl(url, "gfs_seamless")]);
    expect(calls).toBe(1);
    expect(await a.json()).toEqual(await b.json());
    const again = await cachedFetchUrl(url, "gfs_seamless");
    expect(calls).toBe(1);
    expect(again.headers.get("x-open-meteo-cache")).toBe("hit");
  });
});
