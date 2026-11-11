import type { Scene } from "@map-renderer/shared";
import * as maplibregl from "maplibre-gl";

import {
  fetchTrafficPathSegments,
  pathsFromScene,
  type TrafficStatus,
} from "../traffic/trafficClient.js";

export type { TrafficStatus };

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

  private removePathLayer(): void {
    if (this.map.getLayer(PATH_LAYER_ID)) this.map.removeLayer(PATH_LAYER_ID);
    if (this.map.getSource(PATH_SOURCE_ID)) this.map.removeSource(PATH_SOURCE_ID);
  }

  public clear(): void {
    this.abort?.abort();
    this.abort = null;
    this.removePathLayer();
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
          "line-width": 8,
          "line-opacity": 0.92,
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
  }
}
