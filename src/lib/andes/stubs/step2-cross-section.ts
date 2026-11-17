/**
 * Step 2 hooks — GRAMET / GAMET / vertical cross sections (not implemented in Step 1).
 */

export type CrossSectionRequest = {
  path: { lat: number; lon: number }[];
  validTime: string;
  model: string;
};

export interface CrossSectionProvider {
  /** Fetch vertical section samples along `path` */
  fetchSection(req: CrossSectionRequest): Promise<{ levels: number[]; values: number[][] } | null>;
}

export class CrossSectionStub implements CrossSectionProvider {
  async fetchSection(): Promise<null> {
    return null;
  }
}