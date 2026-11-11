import type { LngLat } from "./scene.js";

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance between two WGS84 points, in meters. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function polylineLengthMeters(coordinates: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += distanceMeters(coordinates[i - 1]!, coordinates[i]!);
  }
  return total;
}

export function formatDistanceMeters(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "";
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

export function pathMidpoint(coordinates: readonly LngLat[]): LngLat | null {
  if (coordinates.length === 0) return null;
  return coordinates[Math.floor(coordinates.length / 2)]!;
}

/** Evenly spaced points along a polyline (endpoints always kept). */
export function samplePolyline<T extends LngLat>(coordinates: readonly T[], maxSamples: number): T[] {
  if (maxSamples < 2 || coordinates.length <= maxSamples) return [...coordinates];
  const picked: T[] = [];
  for (let i = 0; i < maxSamples; i++) {
    const index = Math.round((i / (maxSamples - 1)) * (coordinates.length - 1));
    picked.push(coordinates[index]!);
  }
  return picked;
}
