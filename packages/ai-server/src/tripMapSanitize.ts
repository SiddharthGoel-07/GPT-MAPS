import type { TripRoutePair } from "./tripPrompt.js";

export function normalizePlaceName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Drop blank / duplicate stops while preserving order. */
export function sanitizePlaces(places: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of places) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = normalizePlaceName(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function resolvePlaceIndex(name: string, places: readonly string[]): number | undefined {
  const n = normalizePlaceName(name);
  for (let i = 0; i < places.length; i++) {
    const pn = normalizePlaceName(places[i] as string);
    if (pn === n || pn.includes(n) || n.includes(pn)) return i;
  }
  return undefined;
}

function routeKey(start: string, end: string): string {
  return `${normalizePlaceName(start)}→${normalizePlaceName(end)}`;
}

/** Paths only along the visit order — drops stray LLM edges (e.g. random landmark → Goa). */
export function sanitizeTripRoutes(
  places: readonly string[],
  routes: readonly TripRoutePair[] | undefined
): TripRoutePair[] {
  const stops = sanitizePlaces(places);
  if (stops.length < 2) return [];

  const kept: TripRoutePair[] = [];
  const seen = new Set<string>();

  for (const route of routes ?? []) {
    const si = resolvePlaceIndex(route.start, stops);
    const ei = resolvePlaceIndex(route.end, stops);
    if (si === undefined || ei === undefined || si === ei) continue;
    if (Math.abs(si - ei) !== 1) continue;

    const start = stops[si] as string;
    const end = stops[ei] as string;
    const key = routeKey(start, end);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ start, end });
  }

  if (kept.length > 0) return kept;

  const consecutive: TripRoutePair[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    consecutive.push({ start: stops[i] as string, end: stops[i + 1] as string });
  }
  return consecutive;
}
