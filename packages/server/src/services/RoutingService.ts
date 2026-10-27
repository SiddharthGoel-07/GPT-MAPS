import type { LngLat } from "@map-renderer/shared";

export interface RouteResult {
  coordinates: LngLat[];
  /** true = no road route exists, so this is just a straight line start -> end. */
  straight: boolean;
}

/** OSRM answers with these codes when two points cannot be joined by road. */
const UNROUTABLE_CODES = new Set(["NoRoute", "NoSegment"]);

export class RoutingService {
  public async getRoute(start: LngLat, end: LngLat): Promise<RouteResult> {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${start[0]},${start[1]};${end[0]},${end[1]}` +
      `?overview=full&geometries=geojson`;

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    // OSRM reports "no route" inside a JSON body (HTTP 200 for NoRoute, 400
    // for NoSegment), so read the body before looking at the status.
    let data: { code?: unknown; routes?: unknown } | null = null;
    try {
      data = (await response.json()) as { code?: unknown; routes?: unknown } | null;
    } catch {
      data = null;
    }

    const straight: RouteResult = { coordinates: [start, end], straight: true };

    if (typeof data?.code === "string" && UNROUTABLE_CODES.has(data.code)) {
      return straight;
    }

    // A real outage (5xx, 429, timeouts, garbage) is NOT "no route": a straight
    // line would pass off a guess as a driving route.
    if (!response.ok) {
      throw new Error(`Routing service failed (HTTP ${response.status}).`);
    }

    const routes = data?.routes;
    if (Array.isArray(routes) && routes.length === 0) return straight;

    const coordinates = (routes as Array<{ geometry?: { coordinates?: unknown } }> | undefined)?.[0]
      ?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      throw new Error("Routing service returned an unreadable route.");
    }

    return {
      coordinates: (coordinates as [number, number][]).map(([lng, lat]): LngLat => [lng, lat]),
      straight: false,
    };
  }
}
