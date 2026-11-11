/** Parse "POI, City, State, Country" style trip stop strings. */

export function normalizePlaceName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type CityHint = {
  city: string;
  /** e.g. "Noida, Uttar Pradesh, India" */
  suffix: string;
};

export function parseCityHintFromStop(stop: string): CityHint | null {
  const parts = stop.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const city = parts[1]!;
  if (parts.length >= 4) {
    return { city, suffix: `${city}, ${parts[2]}, ${parts[3]}` };
  }
  if (parts.length === 3) {
    const third = parts[2]!;
    if (/india/i.test(third)) return { city, suffix: `${city}, India` };
    return { city, suffix: `${city}, ${third}, India` };
  }
  return { city, suffix: `${city}, India` };
}

/** Cities appearing in this section’s stop list (preserves order, deduped). */
export function extractCityHints(stops: readonly string[]): CityHint[] {
  const seen = new Set<string>();
  const out: CityHint[] = [];
  for (const stop of stops) {
    const hint = parseCityHintFromStop(stop);
    if (!hint) continue;
    const key = normalizePlaceName(hint.suffix);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hint);
  }
  return out;
}

/** Most common city suffix in the stop list (for this day’s map). */
export function dominantCityHint(stops: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const stop of stops) {
    const hint = parseCityHintFromStop(stop);
    if (!hint) continue;
    counts.set(hint.suffix, (counts.get(hint.suffix) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  for (const [suffix, n] of counts) {
    if (n > max) {
      max = n;
      best = suffix;
    }
  }
  return best;
}

export function cityHintForVagueName(
  placeName: string,
  stops: readonly string[],
  stopIndex: number | undefined
): string | null {
  const n = normalizePlaceName(placeName);

  for (const hint of extractCityHints(stops)) {
    const city = normalizePlaceName(hint.city);
    if (n.includes(city) || city.includes(n)) return hint.suffix;
  }

  if (stopIndex !== undefined && stopIndex >= 0 && stopIndex < stops.length) {
    const self = parseCityHintFromStop(stops[stopIndex] as string);
    if (self) return self.suffix;
    for (const delta of [-1, 1, -2, 2]) {
      const j = stopIndex + delta;
      if (j < 0 || j >= stops.length) continue;
      const neighbor = parseCityHintFromStop(stops[j] as string);
      if (neighbor) return neighbor.suffix;
    }
  }

  return dominantCityHint(stops);
}
