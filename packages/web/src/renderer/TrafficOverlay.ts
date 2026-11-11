import type { Scene } from "@map-renderer/shared";
import type { RasterSourceSpecification } from "maplibre-gl";
import * as maplibregl from "maplibre-gl";

import {
  fetchTrafficPathSegments,
  pathsFromScene,
  type TrafficStatus,
} from "../traffic/trafficClient.js";

export type { TrafficStatus };

const TILE_SOURCE_ID = "tomtom-traffic-tiles";
const TILE_LAYER_ID = "tomtom-traffic-tiles-layer";
const PATH_SOURCE_ID = "tomtom-traffic-paths";
const PATH_LAYER_ID = "tomtom-traffic-paths-layer";

export class TrafficOverlay {
  private enabled = false;
  private loading = false;
  private pathCount = 0;
  private error: string | undefined;
  private fetchGen = 0;
  private abort: AbortController | null = null;
  private authToken: string | undefined;

  constructor(
    private readonly map: maplibregl.Map,
    private readonly onStatus: (status: TrafficStatus) => void,
    authToken?: string
  ) {
    this.authToken = authToken;
  }

  private emit(): void {
    const status: TrafficStatus = {
      enabled: this.enabled,
      loading: this.loading,
      pathCount: this.pathCount,
    };
    if (this.error) status.error = this.error;
    this.onStatus(status);
  }

  public setAuthToken(token: string | undefined): void {
    this.authToken = token;
  }

  private ensureTileLayer(): void {
    if (this.map.getSource(TILE_SOURCE_ID)) return;

    const tiles = [
      `${window.location.origin}/api/traffic/tiles/{z}/{x}/{y}.png`,
    ];

    this.map.addSource(TILE_SOURCE_ID, {
      type: "raster",
      tiles,
      tileSize: 256,
      maxzoom: 22,
      attribution: "© TomTom",
    } satisfies RasterSourceSpecification);

    this.map.addLayer({
      id: TILE_LAYER_ID,
      type: "raster",
      source: TILE_SOURCE_ID,
      paint: {
        "raster-opacity": 0.55,
        "raster-fade-duration": 0,
      },
    });
  }

  private removeTileLayer(): void {
    if (this.map.getLayer(TILE_LAYER_ID)) this.map.removeLayer(TILE_LAYER_ID);
    if (this.map.getSource(TILE_SOURCE_ID)) this.map.removeSource(TILE_SOURCE_ID);
  }

  private removePathLayer(): void {
    if (this.map.getLayer(PATH_LAYER_ID)) this.map.removeLayer(PATH_LAYER_ID);
    if (this.map.getSource(PATH_SOURCE_ID)) this.map.removeSource(PATH_SOURCE_ID);
  }

  public clear(): void {
    this.abort?.abort();
    this.abort = null;
    this.removePathLayer();
    this.removeTileLayer();
    this.loading = false;
    this.pathCount = 0;
    this.error = undefined;
  }

  public destroy(): void {
    this.enabled = false;
    this.clear();
  }

  public setEnabled(on: boolean, scene: Scene | null): void {
    this.enabled = on;
    if (!on) {
      this.clear();
      this.emit();
      return;
    }
    void this.sync(scene);
  }

  /** Re-attach TomTom layers after setStyle(). */
  public onStyleReady(scene: Scene | null): void {
    if (!this.enabled) return;
    void this.sync(scene);
  }

  public async sync(scene: Scene | null): Promise<void> {
    if (!this.enabled) return;

    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;
    const gen = ++this.fetchGen;

    this.clearMarkersOnly();
    this.loading = true;
    this.error = undefined;
    this.emit();

    if (!scene) {
      this.loading = false;
      this.emit();
      return;
    }

    try {
      this.ensureTileLayer();

      const paths = pathsFromScene(scene);
      this.pathCount = paths.length;

      if (paths.length === 0) {
        this.loading = false;
        this.emit();
        return;
      }

      const segments = await fetchTrafficPathSegments(paths, this.authToken, controller.signal);
      if (gen !== this.fetchGen || controller.signal.aborted) {
        if (gen === this.fetchGen) {
          this.loading = false;
          this.emit();
        }
        return;
      }

      const features = segments.map((seg, index) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: seg.coordinates,
        },
        properties: {
          color: seg.color,
          pathId: seg.pathId,
          index,
        },
      }));

      this.map.addSource(PATH_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });

      this.map.addLayer({
        id: PATH_LAYER_ID,
        type: "line",
        source: PATH_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 7,
          "line-opacity": 0.95,
        },
      });

      this.loading = false;
      this.emit();
    } catch (error) {
      if (controller.signal.aborted) {
        if (gen === this.fetchGen) {
          this.loading = false;
          this.emit();
        }
        return;
      }
      console.warn("Traffic overlay failed", error);
      this.error = error instanceof Error ? error.message : "Traffic unavailable";
      this.loading = false;
      this.emit();
    }
  }

  private clearMarkersOnly(): void {
    this.removePathLayer();
    this.removeTileLayer();
  }
}
