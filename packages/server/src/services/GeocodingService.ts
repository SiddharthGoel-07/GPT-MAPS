import type { LngLat } from "@map-renderer/shared";
import {
  PromiseCache,
  REQUEST_TIMEOUT_MS,
  nominatimLimiter,
  normalizeQuery,
} from "./nominatim.js";

export class GeocodingService {
  private readonly cache = new PromiseCache<LngLat>();

  public getCoordinates(location: string): Promise<LngLat> {
    return this.cache.get(normalizeQuery(location), () =>
      nominatimLimiter.run(() => this.fetchCoordinates(location))
    );
  }

  private async fetchCoordinates(location: string): Promise<LngLat> {
    const url =
      `https://nominatim.openstreetmap.org/search?` +
      new URLSearchParams({
        q: location,
        format: "jsonv2",
        limit: "1",
      });

    const response = await fetch(url, {
      headers: {
        "User-Agent": "map-renderer-mcp",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Failed to geocode location (status ${response.status}).`);
    }

    const results = await response.json();

    if (results.length === 0) {
      throw new Error(`Location "${location}" not found.`);
    }

    const lat = Number(results[0].lat);
    const lng = Number(results[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`Geocoder returned invalid coordinates for "${location}".`);
    }
    return [lng, lat];
  }
}
