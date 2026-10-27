import type { LngLat } from "@map-renderer/shared";

export class RoutingService {
  public async getRoute(start: LngLat, end: LngLat): Promise<LngLat[]> {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${start[0]},${start[1]};${end[0]},${end[1]}` +
      `?overview=full&geometries=geojson`;

    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });

    if (!response.ok) {
      throw new Error("Failed to fetch route.");
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error("No route found.");
    }

    return (data.routes[0].geometry.coordinates as [number, number][]).map(
      ([lng, lat]): LngLat => [lng, lat]
    );
  }
}