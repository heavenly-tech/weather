/**
 * Playwright capture of /andes (requires production or dev server on BASE_URL).
 * No Cesium Ion token — ellipsoid + OSM baseline.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://127.0.0.1:43123";
const OUT = path.join(process.cwd(), "public", "screenshots");

async function waitForServer(url, ms = 120_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Server not ready at ${url}`);
}

async function main() {
  const shouldSpawn = !process.env.CAPTURE_BASE_URL;
  let child;
  if (shouldSpawn) {
    child = spawn("node", ["server.js"], {
      cwd: path.join(process.cwd(), ".next", "standalone"),
      stdio: "ignore",
      env: { ...process.env, PORT: "43123", HOSTNAME: "127.0.0.1" },
    });
    await waitForServer(BASE);
  }

  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`${BASE}/andes`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(8000);

  await page.screenshot({ path: path.join(OUT, "andes-ceiling.png"), fullPage: false });
  await page.locator("input[type=range]").first().screenshot({ path: path.join(OUT, "andes-time-slider.png") });

  const section = page.locator("section").filter({ hasText: "Per-airfield ceiling timelines" });
  await section.screenshot({ path: path.join(OUT, "andes-timeline.png") });

  const controls = page.locator('input[type="number"]').first();
  await controls.fill("850");
  await page.waitForTimeout(4000);
  await page.locator(".cesium-viewer, [class*=cesium]").first().screenshot({
    path: path.join(OUT, "andes-slice.png"),
    timeout: 30_000,
  }).catch(async () => {
    await page.screenshot({ path: path.join(OUT, "andes-slice.png") });
  });

  // Short GIF via Playwright video + ffmpeg if available — use frame burst as fallback
  const frames = path.join(OUT, "andes-slider-frames");
  await mkdir(frames, { recursive: true });
  const slider = page.locator("input[type=range]").first();
  for (let i = 0; i < 8; i++) {
    await slider.evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, i * 3);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(frames, `frame-${i}.png`) });
  }

  await browser.close();
  if (child) child.kill();

  const { execSync } = await import("node:child_process");
  try {
    execSync(
      `ffmpeg -y -framerate 2 -i "${path.join(frames, "frame-%d.png")}" -vf "scale=960:-1" "${path.join(OUT, "andes-time-slider.gif")}"`,
      { stdio: "ignore" }
    );
  } catch {
    console.warn("ffmpeg not available — GIF not written (frames remain in", frames, ")");
  }

  console.log("Screenshots written to", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});