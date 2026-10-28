import type { LngLat } from "@map-renderer/shared";
import {
  PromiseCache,
  REQUEST_TIMEOUT_MS,
  nominatimLimiter,
  normalizeQuery,
} from "./nominatim.js";

/** How many candidates we ask Nominatim for. */
const CANDIDATES = 5;
/** A runner-up is "a real alternative" if it is at least this important compared with the best. */
const ALTERNATIVE_RATIO = 0.7;
const MAX_ALTERNATIVES = 2;
const MAX_NAME_CHARS = 120;

export interface ResolvedPlace {
  point: LngLat;
  /** Full name of the place the geocoder matched, e.g. "Paris, Île-de-France, France". */
  name: string;
  /** Other plausible matches (names only), so a wrong pick can be corrected. */
  alternatives: string[];
}

interface Candidate {
  point: LngLat;
  name: string;
  importance: number;
  order: number;
}

const shorten = (text: string): string =>
  text.length > MAX_NAME_CHARS ? `${text.slice(0, MAX_NAME_CHARS - 1)}…` : text;

function toCandidate(raw: unknown, order: number, query: string): Candidate | null {
  if (typeof raw !== "object" || raw === null) return null;
  const item = raw as Record<string, unknown>;
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const importance = Number(item.importance);
  const displayName = typeof item.display_name === "string" ? item.display_name.trim() : "";
  return {
    point: [lng, lat],
    name: shorten(displayName || query),
    importance: Number.isFinite(importance) ? importance : 0,
    order,
  };
}

/**
 * Picks the most important candidate (Nominatim's own `importance`; ties keep
 * Nominatim's order) and lists up to two clearly different, similarly
 * important runners-up. Pure, so it can be tested without a network.
 */
export function pickPlace(results: unknown, query: string): ResolvedPlace | null {
  if (!Array.isArray(results)) return null;
  const candidates = results
    .map((raw, order) => toCandidate(raw, order, query))
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.importance - a.importance || a.order - b.order);

  const best = candidates[0];
  if (!best) return null;

  const alternatives: string[] = [];
  for (const other of candidates.slice(1)) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;
    if (other.name === best.name || alternatives.includes(other.name)) continue;
    if (other.importance < best.importance * ALTERNATIVE_RATIO) continue;
    alternatives.push(other.name);
  }
  return { point: best.point, name: best.name, alternatives };
}

/** Text for the model: which place was matched, and what else it could have been. */
export function describePlace(query: string, place: ResolvedPlace): string {
  const matched = `Matched "${query}" to "${place.name}".`;
  if (place.alternatives.length === 0) return matched;
  const others = place.alternatives.map((a) => `"${a}"`).join("; ");
  return (
    `${matched} Other possible matches: ${others}. ` +
    "If that is not the place the user meant, call again with a more specific name."
  );
}

export class GeocodingService {
  private readonly cache = new PromiseCache<ResolvedPlace>();

  public resolve(location: string): Promise<ResolvedPlace> {
    return this.cache.get(normalizeQuery(location), () =>
      nominatimLimiter.run(() => this.fetchPlace(location))
    );
  }

  /** Convenience for callers that only need the coordinates. */
  public async getCoordinates(location: string): Promise<LngLat> {
    return (await this.resolve(location)).point;
  }

  private async fetchPlace(location: string): Promise<ResolvedPlace> {
    const url =
      `https://nominatim.openstreetmap.org/search?` +
      new URLSearchParams({
        q: location,
        format: "jsonv2",
        limit: String(CANDIDATES),
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

    const results: unknown = await response.json();
    if (Array.isArray(results) && results.length === 0) {
      throw new Error(`Location "${location}" not found.`);
    }

    const place = pickPlace(results, location);
    if (!place) {
      throw new Error(`Geocoder returned invalid coordinates for "${location}".`);
    }
    return place;
  }
}
