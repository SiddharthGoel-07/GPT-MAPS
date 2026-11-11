import type { PathObject, Scene } from "@map-renderer/shared";
import { samplePolyline } from "@map-renderer/shared";

/** TomTom flow is sampled along the route; full OSRM polylines must not be POSTed. */
const TRAFFIC_COORD_SAMPLES = 24;

export type TrafficPathSegment = {
  pathId: string;
  coordinates: [number, number][];
  color: string;
};

export type TrafficStatus = {
  enabled: boolean;
  loading: boolean;
  pathCount: number;
  error?: string;
};

export function pathsFromScene(scene: Scene): { id: string; coordinates: [number, number][] }[] {
  const out: { id: string; coordinates: [number, number][] }[] = [];
  for (const object of scene.objects) {
    if (object.type !== "path") continue;
    const path = object as PathObject;
    if (path.coordinates.length < 2) continue;
    out.push({
      id: path.id,
      coordinates: samplePolyline(path.coordinates, TRAFFIC_COORD_SAMPLES).map(
        (p) => [p[0], p[1]] as [number, number]
      ),
    });
  }
  return out;
}

export async function fetchTrafficPathSegments(
  paths: { id: string; coordinates: [number, number][] }[],
  authToken: string | undefined,
  signal?: AbortSignal
): Promise<TrafficPathSegment[]> {
  if (paths.length === 0) return [];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const init: RequestInit = {
    method: "POST",
    headers,
    body: JSON.stringify({ paths }),
  };
  if (signal) init.signal = signal;

  const res = await fetch("/api/traffic/paths", init);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Traffic request failed (${res.status})`);
  }

  const data = (await res.json()) as { segments?: TrafficPathSegment[] };
  return Array.isArray(data.segments) ? data.segments : [];
}
