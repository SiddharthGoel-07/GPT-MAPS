import { Point } from "@map-renderer/shared";
import {
  PromiseCache,
  REQUEST_TIMEOUT_MS,
  nominatimLimiter,
  normalizeQuery,
} from "./nominatim.js";

export class GeocodingService {
  private readonly cache = new PromiseCache<Point>();

  public getCoordinates(location: string): Promise<Point> {
    return this.cache.get(normalizeQuery(location), () =>
      nominatimLimiter.run(() => this.fetchCoordinates(location))
    );
  }

  private async fetchCoordinates(location: string): Promise<Point> {
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

    return new Point(Number(results[0].lat), Number(results[0].lon));
  }
}
