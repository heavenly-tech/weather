import type { SynopticProduct } from "./types";

export const SYNOPTIC_PRODUCTS: SynopticProduct[] = [
  {
    id: "sam-00",
    title: "South America surface 00Z",
    cycle: "00Z",
    description: "NOAA WPC International Desk surface analysis for the continent, 00 UTC.",
    imagePath: "/api/synoptic/image?id=sam-00",
    origin: "https://www.wpc.ncep.noaa.gov/international/sampssfc00.gif",
  },
  {
    id: "sam-06",
    title: "South America surface 06Z",
    cycle: "06Z",
    description: "NOAA WPC surface analysis, 06 UTC.",
    imagePath: "/api/synoptic/image?id=sam-06",
    origin: "https://www.wpc.ncep.noaa.gov/international/sampssfc06.gif",
  },
  {
    id: "sam-12",
    title: "South America surface 12Z",
    cycle: "12Z",
    description: "NOAA WPC surface analysis, 12 UTC.",
    imagePath: "/api/synoptic/image?id=sam-12",
    origin: "https://www.wpc.ncep.noaa.gov/international/sampssfc12.gif",
  },
  {
    id: "sam-18",
    title: "South America surface 18Z",
    cycle: "18Z",
    description: "NOAA WPC surface analysis, 18 UTC.",
    imagePath: "/api/synoptic/image?id=sam-18",
    origin: "https://www.wpc.ncep.noaa.gov/international/sampssfc18.gif",
  },
  {
    id: "sam-d1",
    title: "South America day-1 forecast",
    cycle: "D+1",
    description: "WPC South American desk color surface forecast, day 1.",
    imagePath: "/api/synoptic/image?id=sam-d1",
    origin: "https://www.wpc.ncep.noaa.gov/international/d1.gif",
  },
  {
    id: "sam-d2",
    title: "South America day-2 forecast",
    cycle: "D+2",
    description: "WPC South American desk color surface forecast, day 2.",
    imagePath: "/api/synoptic/image?id=sam-d2",
    origin: "https://www.wpc.ncep.noaa.gov/international/d2.gif",
  },
];

export function synopticById(id: string): SynopticProduct | undefined {
  return SYNOPTIC_PRODUCTS.find((p) => p.id === id);
}
