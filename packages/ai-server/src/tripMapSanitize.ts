import type { TripRoutePair } from "./tripPrompt.js";

export function normalizePlaceName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Overview map: drop minor sights, keep city/station hubs. */
const VAGUE_POI_OVERVIEW =
  /\b(plantation|spice|hotel|resort|guesthouse|beach|falls|fort|market|flea|bazaar|temple|church|monument)\b/;

/** Geocoding: append region when the query string is ambiguous globally. */
const VAGUE_POI_GEOCODE =
  /\b(plantation|spice|hotel|resort|guesthouse|beach|falls|fort|palace|museum|market|flea|bazaar|temple|church|monument|station|junction|railway|gate|garden|park|ghat|lake|stadium|university|bridge|café|cafe)\b/;

/** Infer region so Nominatim does not match a random global POI (e.g. "Spice Plantation" → Russia). */
export function inferGeoHint(stops: readonly string[], userPrompt = ""): string {
  const blob = `${userPrompt} ${stops.join(" ")}`.toLowerCase();
  if (/\bgoa\b|madgaon|margao|mapusa|vasco|panaji|panjim|calangute|baga|anjuna|dudhsagar/.test(blob)) {
    return "Goa, India";
  }
  if (/\bkerala\b|kochi|cochin|munnar|alleppey|thiruvananthapuram/.test(blob)) {
    return "Kerala, India";
  }
  if (/\bmumbai\b|\bbombay\b|maharashtra/.test(blob)) return "Maharashtra, India";
  if (/\bmathura\b|\bvrindavan\b|\bgovardhan\b|\bbraj\b/.test(blob)) {
    return "Mathura, Uttar Pradesh, India";
  }
  if (/\bdelhi\b|ncr|gurgaon|noida/.test(blob)) return "Delhi, India";
  if (/\bkarnataka\b|bangalore|bengaluru|mysore/.test(blob)) return "Karnataka, India";
  if (/\btamil nadu\b|chennai|madurai/.test(blob)) return "Tamil Nadu, India";
  if (/\brajasthan\b|jaipur|udaipur|jodhpur|agra|fatehpur/.test(blob)) return "Rajasthan, India";
  if (/\bdelhi\b.*\bagra\b|\bagra\b.*\bjaipur\b|golden triangle/.test(blob)) return "Rajasthan, India";
  return "India";
}

export function qualifyPlaceForGeocoding(
  name: string,
  hint: string,
  stops: readonly string[],
  sectionContext = ""
): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes(",")) return trimmed;

  const n = normalizePlaceName(trimmed);
  const blob = `${stops.join(" ")} ${sectionContext}`.toLowerCase();

  if (/\bcity palace\b/.test(n)) {
    if (/\bjaipur\b/.test(blob)) return "City Palace, Jaipur, Rajasthan, India";
    if (/\budaipur\b/.test(blob)) return "City Palace, Udaipur, Rajasthan, India";
    return `${trimmed}, ${hint}`;
  }
  if (/\bagra fort\b/.test(n) || (/\bfort\b/.test(n) && /\bagra\b/.test(blob))) {
    return `${trimmed.includes("Agra") ? trimmed : `${trimmed}, Agra`}, Uttar Pradesh, India`;
  }
  if (/\btaj mahal\b/.test(n)) return "Taj Mahal, Agra, Uttar Pradesh, India";

  if (/\b(plantation|spice)\b/.test(n)) {
    const region = /goa|madgaon|panaji|calangute|margao/.test(blob) ? "Goa, India" : hint;
    return `${trimmed}, ${region}`;
  }
  if (VAGUE_POI_GEOCODE.test(n) && !/\b(city|district)\b/.test(n)) {
    const region = regionalHintForVaguePoi(n, blob, hint);
    return `${trimmed}, ${region}`;
  }
  return trimmed;
}

/** Prefer the day’s cities over trip-wide hints (e.g. Delhi title + Mathura day stops). */
function regionalHintForVaguePoi(placeName: string, blob: string, fallback: string): string {
  if (/\bmathura\b/.test(placeName)) return "Mathura, Uttar Pradesh, India";
  if (/\bvrindavan\b/.test(placeName)) return "Vrindavan, Uttar Pradesh, India";
  if (/\bgovardhan\b/.test(placeName)) return "Govardhan, Uttar Pradesh, India";
  if (/\bvrindavan\b/.test(blob)) return "Vrindavan, Uttar Pradesh, India";
  if (/\bmathura\b|\bgovardhan\b/.test(blob)) return "Mathura, Uttar Pradesh, India";
  return fallback;
}

export function isVaguePoiName(name: string): boolean {
  if (name.includes(",")) return false;
  return VAGUE_POI_OVERVIEW.test(normalizePlaceName(name));
}

/** Overview map: major hubs only — not every beach/plantation on one chained route. */
export function sanitizeOverviewPlaces(places: readonly string[]): string[] {
  const stops = sanitizePlaces(places);
  if (stops.length <= 5) {
    return stops.filter((p) => !isVaguePoiName(p)).length >= 2 ? stops.filter((p) => !isVaguePoiName(p)) : stops;
  }
  const major = stops.filter((p) => !isVaguePoiName(p));
  if (major.length >= 2) return major.slice(0, 8);
  return [stops[0] as string, stops[stops.length - 1] as string];
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
