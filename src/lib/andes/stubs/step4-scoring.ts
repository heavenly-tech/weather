/**
 * Step 4 hooks — score logged METAR/TAF products against observations.
 */

import type { ProductLogEntry } from "@/lib/andes/product-log";

export type ScoreReport = {
  productId: string;
  ceilingMaeFt: number | null;
  visHitRate: number | null;
  notes: string;
};

export interface ProductScorer {
  scoreAgainstMetar(entry: ProductLogEntry, observedMetarRaw: string): Promise<ScoreReport>;
}

export class ProductScorerStub implements ProductScorer {
  async scoreAgainstMetar(entry: ProductLogEntry): Promise<ScoreReport> {
    return {
      productId: entry.id,
      ceilingMaeFt: null,
      visHitRate: null,
      notes: "Scoring not implemented (Step 4).",
    };
  }
}