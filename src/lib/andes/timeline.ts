import type { AndesModelId } from "@/lib/andes/models";

export type TimelinePoint = {
  time: string;
  ceilingFtAgl: number | null;
  category: string;
};

export type ObservedCeilingSeries = {
  label: string;
  points: TimelinePoint[];
};

export type ModelCeilingSeries = {
  model: AndesModelId;
  label: string;
  points: TimelinePoint[];
  unavailable?: string;
};
