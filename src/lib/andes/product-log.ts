/**
 * Storage interface for generated METAR/TAF products (Step 4 scoring hooks in).
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

function logPath(): string {
  return process.env.PRODUCT_LOG_PATH ?? path.join(process.cwd(), "data", "product-log.jsonl");
}

export class JsonlProductLogStore implements ProductLogStore {
  async append(entry: ProductLogEntry): Promise<void> {
    const file = logPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(/* turbopackIgnore: true */ file, `${JSON.stringify(entry)}\n`, "utf8");
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