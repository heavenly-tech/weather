/**
 * Storage interface for generated METAR/TAF products (Step 4 scoring hooks in).
 * Appends only when PRODUCT_LOG_ENABLED=1; rotates at PRODUCT_LOG_MAX_LINES (default 2000).
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AndesModelId } from "@/lib/andes/models";

export type ProductKind = "METAR" | "TAF";

export type ProductLogEntry = {
  id: string;
  kind: ProductKind;
  model: AndesModelId | "multi";
  runTime: string;
  validTime: string;
  point: { lat: number; lon: number; icao?: string };
  raw: string;
  createdAt: string;
};

export interface ProductLogStore {
  append(entry: ProductLogEntry): Promise<void>;
  list(limit?: number): Promise<ProductLogEntry[]>;
}

const recentKeys = new Map<string, number>();
const DEDUPE_MS = 60 * 60 * 1000;

function logPath(): string {
  return process.env.PRODUCT_LOG_PATH ?? path.join(process.cwd(), "data", "product-log.jsonl");
}

function maxLines(): number {
  return Number(process.env.PRODUCT_LOG_MAX_LINES ?? 2000);
}

export function loggingEnabled(): boolean {
  return process.env.PRODUCT_LOG_ENABLED === "1";
}

export class JsonlProductLogStore implements ProductLogStore {
  async append(entry: ProductLogEntry): Promise<void> {
    if (!loggingEnabled()) return;
    const key = `${entry.kind}:${entry.point.icao}:${entry.validTime}:${entry.model}`;
    const now = Date.now();
  const last = recentKeys.get(key);
    if (last != null && now - last < DEDUPE_MS) return;
    recentKeys.set(key, now);

    const file = logPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(/* turbopackIgnore: true */ file, `${JSON.stringify(entry)}\n`, "utf8");

    try {
      const text = await fs.readFile(/* turbopackIgnore: true */ file, "utf8");
      const lines = text.trim().split("\n").filter(Boolean);
      if (lines.length > maxLines()) {
        await fs.writeFile(file, `${lines.slice(-maxLines()).join("\n")}\n`, "utf8");
      }
    } catch {
      /* ignore */
    }
  }

  async list(limit = 500): Promise<ProductLogEntry[]> {
    const file = logPath();
    try {
      const text = await fs.readFile(/* turbopackIgnore: true */ file, "utf8");
      const lines = text.trim().split("\n").filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l) as ProductLogEntry);
    } catch {
      return [];
    }
  }
}

let defaultStore: ProductLogStore | null = null;

export function productLogStore(): ProductLogStore {
  if (!defaultStore) defaultStore = new JsonlProductLogStore();
  return defaultStore;
}

export function newLogId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}