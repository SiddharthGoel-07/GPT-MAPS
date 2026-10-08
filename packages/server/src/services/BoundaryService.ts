import { Point, PolygonGeometry } from "@map-renderer/shared";
import {
  PromiseCache,
  REQUEST_TIMEOUT_MS,
  nominatimLimiter,
  normalizeQuery,
} from "./nominatim.js";

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export class BoundaryService {
  private readonly cache = new PromiseCache<PolygonGeometry>(100);

  public getBoundary(location: string): Promise<PolygonGeometry> {
    return this.cache.get(normalizeQuery(location), () =>
      nominatimLimiter.run(() => this.fetchBoundary(location))
    );
  }

  private async fetchBoundary(
    location: string
  ): Promise<PolygonGeometry> {
    const params = new URLSearchParams({
      q: location,
      format: "geojson",
      polygon_geojson: "1",
      limit: "1",
    });

    const url = `https://nominatim.openstreetmap.org/search?${params}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "map-renderer-mcp/0.1.0",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Nominatim request failed with status ${response.status}.`
      );
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      throw new Error(`Boundary for "${location}" not found.`);
    }

    const feature = data.features[0];
    const geometry = feature.geometry;

    if (!geometry) {
      throw new Error(
        `Invalid GeoJSON: missing geometry for "${location}".`
      );
    }

    const points = this.extractPoints(geometry);

    if (points.length === 0) {
      throw new Error(
        `No valid coordinates found for "${location}".`
      );
    }

    return new PolygonGeometry(points);
  }

  private extractPoints(geometry: GeoJsonGeometry): Point[] {
    const points: Point[] = [];

    if (geometry.type === "Polygon") {
      const coordinates = (geometry.coordinates as number[][][])[0] ?? [];
      for (const [lon, lat] of coordinates as [number, number][]) {
        points.push(new Point(lat, lon));
      }
    } else if (geometry.type === "MultiPolygon") {
      const firstPolygon = (geometry.coordinates as number[][][][])[0] ?? [];
      const coordinates = firstPolygon[0] ?? [];
      for (const [lon, lat] of coordinates as [number, number][]) {
        points.push(new Point(lat, lon));
      }
    } else {
      throw new Error(
        `Unsupported geometry type: ${geometry.type}. Expected Polygon or MultiPolygon.`
      );
    }

    return points;
  }
}
