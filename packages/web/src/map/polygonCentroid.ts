import type { PolygonObject } from "@map-renderer/shared";

/** Representative point for a region (largest outer ring, simple mean). */
export function polygonCentroid(polygons: PolygonObject["polygons"]): [number, number] | null {
  let best: [number, number][] | null = null;
  for (const rings of polygons) {
    const outer = rings[0];
    if (!outer?.length) continue;
    if (!best || outer.length > best.length) best = outer;
  }
  if (!best?.length) return null;

  let lon = 0;
  let lat = 0;
  for (const p of best) {
    lon += p[0];
    lat += p[1];
  }
  return [lon / best.length, lat / best.length];
}
