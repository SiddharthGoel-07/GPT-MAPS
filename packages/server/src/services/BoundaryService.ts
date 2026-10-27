import { MAX_POLYGON_POINTS } from "@map-renderer/shared";
import type { LngLat } from "@map-renderer/shared";
import { parseGeoJsonPolygons, simplifyPolygons } from "../geometry.js";
import {
  PromiseCache,
  REQUEST_TIMEOUT_MS,
  nominatimLimiter,
  normalizeQuery,
} from "./nominatim.js";

function maxPointsFromEnv(): number {
  const n = Number(process.env.POLYGON_MAX_POINTS);
  const value = Number.isInteger(n) && n >= 10 ? n : 20_000;
  return Math.min(value, MAX_POLYGON_POINTS);
}

const POLYGON_MAX_POINTS = maxPointsFromEnv();

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
      // Ask for a slightly simplified shape (tolerance in degrees, about 100 m):
      // invisible on a map, but much smaller for countries.
      polygon_threshold: "0.001",
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

    // Every polygon (islands) and every ring (holes), capped in size.
    const polygons = parseGeoJsonPolygons(geometry);

    if (polygons.length === 0) {
      throw new Error(
        `No valid coordinates found for "${location}".`
      );
    }

    return simplifyPolygons(polygons, POLYGON_MAX_POINTS);
  }
}
