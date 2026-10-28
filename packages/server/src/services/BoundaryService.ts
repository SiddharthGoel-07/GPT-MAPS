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

/**
 * Boundary results are big (every candidate carries its full outline), so we
 * ask for fewer candidates than for plain geocoding.
 */
const CANDIDATES = 3;
const MAX_NAME_CHARS = 120;

export interface ResolvedBoundary {
  polygons: LngLat[][][];
  /** Full name of the area that was matched. */
  name: string;
}

interface Feature {
  geometry?: { type?: unknown; coordinates?: unknown } | null;
  properties?: { display_name?: unknown; importance?: unknown } | null;
}

const shorten = (text: string): string =>
  text.length > MAX_NAME_CHARS ? `${text.slice(0, MAX_NAME_CHARS - 1)}…` : text;

const isArea = (feature: Feature): boolean =>
  feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon";

/**
 * Chooses the best AREA among the candidates: Points and lines are skipped
 * (they cannot be highlighted), the most important area wins, ties keep
 * Nominatim's order. An area whose rings are all unusable is skipped too.
 * Pure, so it can be tested without a network.
 */
export function pickBoundary(features: unknown, query: string): ResolvedBoundary | null {
  if (!Array.isArray(features)) return null;

  const areas = features
    .map((raw, order) => ({ feature: raw as Feature, order }))
    .filter(({ feature }) => typeof feature === "object" && feature !== null && isArea(feature))
    .map(({ feature, order }) => {
      const importance = Number(feature.properties?.importance);
      return { feature, order, importance: Number.isFinite(importance) ? importance : 0 };
    })
    .sort((a, b) => b.importance - a.importance || a.order - b.order);

  for (const { feature } of areas) {
    const polygons = parseGeoJsonPolygons(feature.geometry as { type: string; coordinates: unknown });
    if (polygons.length === 0) continue;
    const displayName = feature.properties?.display_name;
    const name = typeof displayName === "string" && displayName.trim() ? displayName.trim() : query;
    return { polygons, name: shorten(name) };
  }
  return null;
}

export class BoundaryService {
  private readonly cache = new PromiseCache<ResolvedBoundary>(100);

  public getBoundary(location: string): Promise<ResolvedBoundary> {
    return this.cache.get(normalizeQuery(location), () =>
      nominatimLimiter.run(() => this.fetchBoundary(location))
    );
  }

  private async fetchBoundary(location: string): Promise<ResolvedBoundary> {
    const params = new URLSearchParams({
      q: location,
      format: "geojson",
      polygon_geojson: "1",
      // Ask for a slightly simplified shape (tolerance in degrees, about 100 m):
      // invisible on a map, but much smaller for countries.
      polygon_threshold: "0.001",
      limit: String(CANDIDATES),
    });

    const url = `https://nominatim.openstreetmap.org/search?${params}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "map-renderer-mcp/0.1.0",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Nominatim request failed with status ${response.status}.`);
    }

    const data = (await response.json()) as { features?: unknown };

    if (!Array.isArray(data.features) || data.features.length === 0) {
      throw new Error(`Boundary for "${location}" not found.`);
    }

    const best = pickBoundary(data.features, location);
    if (!best) {
      throw new Error(
        `"${location}" matched only a point or line, not an area with a boundary. ` +
          "Try a more specific region name (a city, state or country), or use createMarker to mark the place."
      );
    }

    return { polygons: simplifyPolygons(best.polygons, POLYGON_MAX_POINTS), name: best.name };
  }
}
