import type { FlightCategory } from "@/lib/types";

export type CeilingCell = {
  lat: number;
  lon: number;
  elevM: number;
  ceilingFtAgl: number | null;
  category: FlightCategory;
  obscured: boolean;
  cloudBaseMslM?: number | null;
  lowCloudUnresolved?: boolean;
  precipMmH?: number | null;
};
