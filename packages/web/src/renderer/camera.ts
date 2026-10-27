import type { Scene } from "@map-renderer/shared";

/** [[west, south], [east, north]] */
export type SceneBounds = [[number, number], [number, number]];

export const FIT_PADDING = 50;
/** Stops a single marker (or tiny scene) from zooming to the maximum. */
export const FIT_MAX_ZOOM = 12;

/** Bounding box of everything in the scene, or null if the scene is empty. */
export function computeSceneBounds(scene: Scene): SceneBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  const extend = (p: readonly [number, number]): void => {
    if (p[0] < west) west = p[0];
    if (p[0] > east) east = p[0];
    if (p[1] < south) south = p[1];
    if (p[1] > north) north = p[1];
  };

  for (const object of scene.objects) {
    switch (object.type) {
      case "marker":
      case "label":
        extend(object.position);
        break;
      case "path":
        object.coordinates.forEach(extend);
        break;
      case "polygon":
        // Outer rings are enough: holes lie inside them.
        for (const polygon of object.polygons) polygon[0]?.forEach(extend);
        break;
    }
  }

  if (west > east) return null;
  return [[west, south], [east, north]];
}
