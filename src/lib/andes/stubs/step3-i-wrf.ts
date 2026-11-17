/**
 * Step 3 hooks — I-WRF / omastorm tile layer (MIT-licensed engine may supply tiles later).
 *
 * If integrating code from https://github.com/celestial-fix/omastorm retain its MIT licence notice.
 */

export type TileLayerSpec = {
  id: string;
  urlTemplate: string;
  attribution: string;
};

export interface IwrfTileSource {
  layerForRun(runTime: string, variable: string): Promise<TileLayerSpec | null>;
}

export class IwrfTileStub implements IwrfTileSource {
  async layerForRun(): Promise<null> {
    return null;
  }
}