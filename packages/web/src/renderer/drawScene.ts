import type {
  FillLayerSpecification,
  GeoJSONSourceSpecification,
  LineLayerSpecification,
} from "maplibre-gl";
import type {
  LabelObject,
  LngLat,
  MarkerObject,
  PathObject,
  PolygonObject,
  Scene,
} from "@map-renderer/shared";
import { FIT_MAX_ZOOM, FIT_PADDING, computeSceneBounds } from "./camera.js";

/*
 * Drawing logic, independent of maplibre-gl at runtime (type imports only),
 * so it can be tested in Node with a fake map.
 *
 * Rendering is TRANSACTIONAL: the new scene is drawn into a new "rendered
 * state" whose layer/source ids are namespaced by a generation number. If
 * anything throws while drawing, the partial new state is removed and the
 * error is rethrown, so the previous map is still intact. Only after the
 * new state is complete is the old state removed.
 */

/** The subset of maplibre-gl's Map that drawing needs. */
export interface MapLike {
  addSource(id: string, source: GeoJSONSourceSpecification): unknown;
  addLayer(layer: FillLayerSpecification | LineLayerSpecification): unknown;
  removeLayer(id: string): unknown;
  removeSource(id: string): unknown;
  getLayer(id: string): unknown;
  getSource(id: string): unknown;
  fitBounds(
    bounds: [[number, number], [number, number]],
    options: { padding: number; maxZoom: number }
  ): unknown;
}

export interface Removable {
  remove(): unknown;
}

/** Creates a DOM marker/label AND adds it to the map. */
export interface MarkerFactories {
  createMarker(marker: MarkerObject): Removable;
  createLabel(label: LabelObject): Removable;
}

export interface RenderedState {
  readonly generation: number;
  readonly layerIds: string[];
  readonly sourceIds: string[];
  readonly overlays: Removable[];
}

const DASH: number[] = [4, 2];

export function labelCss(label: LabelObject): Record<string, string> {
  return {
    color: label.color,
    fontSize: `${label.fontSize}px`,
    fontWeight: label.fontWeight,
    opacity: String(label.opacity),
    backgroundColor: label.backgroundColor ?? "rgba(255, 255, 255, 0.7)",
    padding: "2px 6px",
    borderRadius: "4px",
    whiteSpace: "nowrap",
    transform: "translate(-50%, -100%)",
  };
}

/** GeoJSON rings must be closed; returns copies, never mutates the scene. */
function closeRing(ring: readonly LngLat[]): LngLat[] {
  const copy = ring.map((p): LngLat => [p[0], p[1]]);
  const first = copy[0];
  const last = copy[copy.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    copy.push([first[0], first[1]]);
  }
  return copy;
}

function drawPath(map: MapLike, state: RenderedState, path: PathObject): void {
  const id = `r${state.generation}-${path.id}`;
  state.sourceIds.push(id);
  map.addSource(id, {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: { type: "LineString", coordinates: path.coordinates.map((p) => [p[0], p[1]]) },
      properties: {},
    },
  });

  const paint: LineLayerSpecification["paint"] = {
    "line-color": path.color,
    "line-width": path.width,
    "line-opacity": path.opacity,
  };
  if (path.dash) paint["line-dasharray"] = DASH;

  state.layerIds.push(id);
  map.addLayer({ id, type: "line", source: id, paint });
}

function drawPolygon(map: MapLike, state: RenderedState, polygon: PolygonObject): void {
  const id = `r${state.generation}-${polygon.id}`;
  state.sourceIds.push(id);
  map.addSource(id, {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "MultiPolygon",
        coordinates: polygon.polygons.map((rings) => rings.map(closeRing)),
      },
      properties: {},
    },
  });

  state.layerIds.push(id);
  map.addLayer({
    id,
    type: "fill",
    source: id,
    paint: { "fill-color": polygon.fillColor, "fill-opacity": polygon.fillOpacity },
  });

  if (polygon.borderWidth > 0) {
    const borderId = `${id}-border`;
    const paint: LineLayerSpecification["paint"] = {
      "line-color": polygon.borderColor ?? polygon.fillColor,
      "line-width": polygon.borderWidth,
      "line-opacity": 1,
    };
    if (polygon.borderDash) paint["line-dasharray"] = DASH;

    state.layerIds.push(borderId);
    map.addLayer({ id: borderId, type: "line", source: id, paint });
  }
}

/** Removes everything a state added. Best effort: never throws. */
export function disposeState(map: MapLike, state: RenderedState): void {
  for (const overlay of state.overlays) {
    try { overlay.remove(); } catch (e) { console.warn("Failed to remove overlay", e); }
  }
  for (const layerId of state.layerIds) {
    try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch (e) { console.warn("Failed to remove layer", e); }
  }
  for (const sourceId of state.sourceIds) {
    try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch (e) { console.warn("Failed to remove source", e); }
  }
  state.overlays.length = 0;
  state.layerIds.length = 0;
  state.sourceIds.length = 0;
}

/** Draws a whole scene into a NEW state. On failure removes the partial state and rethrows. */
export function drawScene(
  map: MapLike,
  factories: MarkerFactories,
  scene: Scene,
  generation: number
): RenderedState {
  const state: RenderedState = { generation, layerIds: [], sourceIds: [], overlays: [] };

  try {
    for (const object of scene.objects) {
      switch (object.type) {
        case "marker":
          state.overlays.push(factories.createMarker(object));
          break;
        case "label":
          state.overlays.push(factories.createLabel(object));
          break;
        case "path":
          drawPath(map, state, object);
          break;
        case "polygon":
          drawPolygon(map, state, object);
          break;
      }
    }
  } catch (error) {
    disposeState(map, state);
    throw error;
  }

  return state;
}

/**
 * Replaces `previous` with `scene`. If drawing fails, `previous` is left
 * untouched and the error is rethrown. Returns the new state on success.
 */
export function applyScene(
  map: MapLike,
  factories: MarkerFactories,
  previous: RenderedState | null,
  scene: Scene,
  generation: number
): RenderedState {
  const next = drawScene(map, factories, scene, generation);

  if (previous) disposeState(map, previous);

  const bounds = computeSceneBounds(scene);
  if (bounds) {
    try {
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM });
    } catch (e) {
      // The scene is already drawn; a camera failure must not undo it.
      console.warn("fitBounds failed", e);
    }
  }
  return next;
}
