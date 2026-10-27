import type { LngLat } from "@map-renderer/shared";
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
  private readonly cache = new PromiseCache<LngLat[][][]>(100);

  public getBoundary(location: string): Promise<LngLat[][][]> {
    return this.cache.get(normalizeQuery(location), () =>
      nominatimLimiter.run(() => this.fetchBoundary(location))
    );
  }

  private async fetchBoundary(
    location: string
  ): Promise<LngLat[][][]> {
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

    const ring = this.extractOuterRing(geometry);

    if (ring.length < 3) {
      throw new Error(
        `No valid coordinates found for "${location}".`
      );
    }

    // Still only the first polygon's outer ring (islands/holes: flaw B1, later).
    return [[ring]];
  }

  private extractOuterRing(geometry: GeoJsonGeometry): LngLat[] {
    let ring: unknown;

    if (geometry.type === "Polygon") {
      ring = (geometry.coordinates as number[][][])[0];
    } else if (geometry.type === "MultiPolygon") {
      ring = (geometry.coordinates as number[][][][])[0]?.[0];
    } else {
      throw new Error(
        `Unsupported geometry type: ${geometry.type}. Expected Polygon or MultiPolygon.`
      );
    }

    const points: LngLat[] = [];
    for (const pair of (ring as [number, number][] | undefined) ?? []) {
      points.push([pair[0], pair[1]]);
    }
    return points;
  }
}
