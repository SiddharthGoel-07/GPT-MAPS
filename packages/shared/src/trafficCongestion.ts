/** Shared TomTom-style traffic colors (free → heavy). */

export type TrafficScaleStep = {
  label: string;
  color: string;
};

export const TRAFFIC_SCALE: readonly TrafficScaleStep[] = [
  { label: "Free flow", color: "#22c55e" },
  { label: "Light", color: "#3b82f6" },
  { label: "Moderate", color: "#eab308" },
  { label: "Slow", color: "#f97316" },
  { label: "Heavy", color: "#dc2626" },
] as const;

export function congestionLevel(flow: {
  currentSpeed?: number;
  freeFlowSpeed?: number;
  currentTravelTime?: number;
  freeFlowTravelTime?: number;
  confidence?: number;
} | null | undefined): number {
  if (!flow) return 0;
  if (typeof flow.confidence === "number" && flow.confidence < 0.25) return 0;

  const freeT = flow.freeFlowTravelTime;
  const curT = flow.currentTravelTime;
  if (typeof freeT === "number" && typeof curT === "number" && freeT > 0) {
    const delay = (curT - freeT) / freeT;
    return Math.min(1, Math.max(0, delay));
  }

  const freeV = flow.freeFlowSpeed;
  const curV = flow.currentSpeed;
  if (typeof freeV === "number" && freeV > 0 && typeof curV === "number") {
    return Math.min(1, Math.max(0, 1 - curV / freeV));
  }

  return 0;
}

export function congestionColor(level: number): string {
  const x = Math.min(1, Math.max(0, level));
  if (x < 0.12) return TRAFFIC_SCALE[0]!.color;
  if (x < 0.28) return TRAFFIC_SCALE[1]!.color;
  if (x < 0.45) return TRAFFIC_SCALE[2]!.color;
  if (x < 0.65) return TRAFFIC_SCALE[3]!.color;
  return TRAFFIC_SCALE[4]!.color;
}
