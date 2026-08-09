import { LineString, Point } from "@map-renderer/shared";

export class RoutingService {
  public async getRoute(
    start: Point,
    end: Point
  ): Promise<LineString> {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${start.longitude},${start.latitude};${end.longitude},${end.latitude}` +
      `?overview=full&geometries=geojson`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Failed to fetch route.");
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error("No route found.");
    }

    const points = data.routes[0].geometry.coordinates.map(
      ([longitude, latitude]: [number, number]) =>
        new Point(latitude, longitude)
    );

    return new LineString(points);
  }
}