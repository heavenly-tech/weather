import type { FlightCategory } from "@/lib/types";

export const CEILING_LEGEND = {
  VFR: { minFtAgl: 3000, label: "VFR", color: "#22c55e" },
  MVFR: { minFtAgl: 1000, maxFtAgl: 3000, label: "MVFR", color: "#38bdf8" },
  IFR: { minFtAgl: 500, maxFtAgl: 999, label: "IFR", color: "#fbbf24" },
  LIFR: { maxFtAgl: 499, label: "LIFR", color: "#f87171" },
} as const;

export function categoryColor(cat: FlightCategory): string {
  switch (cat) {
    case "VFR":
      return CEILING_LEGEND.VFR.color;
    case "MVFR":
      return CEILING_LEGEND.MVFR.color;
    case "IFR":
      return CEILING_LEGEND.IFR.color;
    case "LIFR":
      return CEILING_LEGEND.LIFR.color;
    default:
      return "#94a3b8";
  }
}
