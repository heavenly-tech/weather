#!/usr/bin/env node
/**
 * Open the 3D field from the Rust server and fail on any CSP violation.
 * The globe has to paint a canvas. WebGL uses SwiftShader when the host GPU
 * is unavailable, which is the case in GitHub Actions.
 *
 *   CSP_BASE_URL=http://127.0.0.1:4310 node scripts/check-csp-globe.mjs
 */
import { chromium } from "playwright";

const base = process.env.CSP_BASE_URL ?? "http://127.0.0.1:4310";

function scriptSrcAllowsEval(csp) {
  const directive = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src "));
  if (!directive) return true;
  return directive.split(/\s+/).includes("'unsafe-eval'");
}

const browser = await chromium.launch({
  args: [
    "--disable-dev-shm-usage",
    "--use-angle=swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const violations = [];
await page.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (event) => {
    const list = window.__cspViolations ?? [];
    list.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
    window.__cspViolations = list;
  });
});
page.on("console", (message) => {
  const text = message.text();
  if (/content security policy/i.test(text)) violations.push(text);
});

const response = await page.goto(`${base}/viz?icao=SCEL`, { waitUntil: "domcontentloaded", timeout: 30000 });
const csp = response?.headers()["content-security-policy"] ?? "";
if (!csp.includes("script-src 'self' 'wasm-unsafe-eval'")) {
  throw new Error(`document CSP is missing the script-src policy: ${csp}`);
}
if (!csp.includes("worker-src 'self' blob:")) {
  throw new Error(`document CSP is missing worker-src: ${csp}`);
}
if (scriptSrcAllowsEval(csp)) {
  throw new Error(`script-src still allows unsafe-eval: ${csp}`);
}

await page.getByRole("heading", { name: "3D visualization" }).waitFor({ timeout: 45000 });
const canvas = page.locator("canvas").first();
await canvas.waitFor({ timeout: 45000 });
const box = await canvas.boundingBox();
if (!box || box.width < 200 || box.height < 200) {
  throw new Error(`globe canvas did not render: ${JSON.stringify(box)}`);
}
const webgl = await page.evaluate(() => {
  const element = document.querySelector("canvas");
  if (!element) return false;
  const gl = element.getContext("webgl2") ?? element.getContext("webgl");
  return Boolean(gl);
});
if (!webgl) throw new Error("the globe canvas has no WebGL context");

await page.waitForTimeout(2000);
const fromPage = await page.evaluate(() => window.__cspViolations ?? []);
const all = [...violations, ...fromPage];
if (all.length) {
  throw new Error(`CSP violations:\n${all.join("\n")}`);
}
console.log("globe rendered with no CSP violations");
await browser.close();
