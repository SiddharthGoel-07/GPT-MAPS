import type { LngLat } from "@map-renderer/shared";

/*
 * Pure helpers for turning a GeoJSON Polygon/MultiPolygon into the scene's
 * `polygons` layout (polygons[i] = [outerRing, ...holes], every ring closed),
 * and for keeping the point count bounded.
 */

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export function countPoints(polygons: readonly (readonly (readonly LngLat[])[])[]): number {
  let n = 0;
  for (const rings of polygons) for (const ring of rings) n += ring.length;
  return n;
}

function asPoint(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = value[0];
  const lat = value[1];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

/** Valid points only, no consecutive duplicates, closed. null if fewer than 3 distinct corners remain. */
function cleanRing(raw: unknown): LngLat[] | null {
  if (!Array.isArray(raw)) return null;

  const open: LngLat[] = [];
  for (const item of raw) {
    const p = asPoint(item);
    if (!p) continue;
    const prev = open[open.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    open.push(p);
  }

  const first = open[0];
  const last = open[open.length - 1];
  if (first && last && open.length > 1 && first[0] === last[0] && first[1] === last[1]) open.pop();

  const start = open[0];
  if (open.length < 3 || !start) return null;
  open.push([start[0], start[1]]);
  return open;
}

/**
 * Keeps EVERY polygon (islands) and every hole. Rings that are unusable are
 * dropped: a bad hole is just removed; a bad outer ring removes its polygon.
 */
export function parseGeoJsonPolygons(geometry: GeoJsonGeometry): LngLat[][][] {
  let rawPolygons: unknown[];

  if (geometry.type === "Polygon") {
    rawPolygons = [geometry.coordinates];
  } else if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    rawPolygons = geometry.coordinates;
  } else {
    throw new Error(
      `Unsupported geometry type: ${geometry.type}. Expected Polygon or MultiPolygon.`
    );
  }

  const result: LngLat[][][] = [];
  for (const rawRings of rawPolygons) {
    if (!Array.isArray(rawRings)) continue;
    const outer = cleanRing(rawRings[0]);
    if (!outer) continue;
    const rings: LngLat[][] = [outer];
    for (const rawHole of rawRings.slice(1)) {
      const hole = cleanRing(rawHole);
      if (hole) rings.push(hole);
    }
    result.push(rings);
  }
  return result;
}

/* ------------------------------ simplification ------------------------------ */

function distanceToSegment(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on a closed ring (iterative: boundaries can have 100k+ points). */
function simplifyRing(ring: readonly LngLat[], tolerance: number): LngLat[] | null {
  const last = ring.length - 1;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[last] = 1;

  const stack: Array<[number, number]> = [[0, last]];
  while (stack.length > 0) {
    const range = stack.pop() as [number, number];
    const [lo, hi] = range;
    const a = ring[lo] as LngLat;
    const b = ring[hi] as LngLat;
    let maxDistance = 0;
    let index = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distanceToSegment(ring[i] as LngLat, a, b);
      if (d > maxDistance) {
        maxDistance = d;
        index = i;
      }
    }
    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([lo, index], [index, hi]);
    }
  }

  const out: LngLat[] = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i] as LngLat);
  return out.length >= 4 ? out : null; // fewer is no longer an area
}

function simplifyOnce(polygons: readonly (readonly (readonly LngLat[])[])[], tolerance: number): LngLat[][][] {
  const out: LngLat[][][] = [];
  for (const rings of polygons) {
    const outer = simplifyRing(rings[0] as readonly LngLat[], tolerance);
    if (!outer) continue; // an island too small for this tolerance disappears
    const kept: LngLat[][] = [outer];
    for (const hole of rings.slice(1)) {
      const s = simplifyRing(hole, tolerance);
      if (s) kept.push(s);
    }
    out.push(kept);
  }
  return out;
}

/** Last resort for absurd caps: the biggest polygon's outer ring, thinned evenly. */
function decimateLargest(polygons: readonly (readonly (readonly LngLat[])[])[], maxPoints: number): LngLat[][][] {
  let best: readonly LngLat[] = [];
  for (const rings of polygons) {
    const outer = rings[0] as readonly LngLat[];
    if (outer.length > best.length) best = outer;
  }
  const open = best.slice(0, -1);
  const budget = Math.max(3, maxPoints - 1);
  const step = Math.max(1, Math.ceil(open.length / budget));
  const thinned: LngLat[] = [];
  for (let i = 0; i < open.length; i += step) thinned.push(open[i] as LngLat);
  const start = thinned[0] as LngLat;
  thinned.push([start[0], start[1]]);
  return [[thinned]];
}

/**
 * Returns the polygons unchanged if they fit in `maxPoints`; otherwise the
 * smallest simplification (Douglas-Peucker, tolerance in degrees) that fits.
 * Holes and islands survive as long as they are bigger than the tolerance.
 */
export function simplifyPolygons(
  polygons: LngLat[][][],
  maxPoints: number
): LngLat[][][] {
  if (countPoints(polygons) <= maxPoints) return polygons;

  // Each pass simplifies the previous (already smaller) result, so the cost is
  // dominated by the first pass instead of repeating on the full input.
  let current = polygons;
  let tolerance = 0.0005;
  for (let step = 0; step < 30; step++) {
    const next = simplifyOnce(current, tolerance);
    if (next.length === 0) break;
    current = next;
    if (countPoints(current) <= maxPoints) return current;
    tolerance *= 1.7;
  }
  return decimateLargest(polygons, maxPoints);
}
