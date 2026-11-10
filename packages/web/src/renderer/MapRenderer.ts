import type { Scene } from "@map-renderer/shared";
import { snippetForPlace } from "../map/sceneGuide.js";
import {
  applyScene,
  disposeState,
  labelCss,
  type MarkerFactories,
  type RenderedState,
} from "./drawScene.js";

import type { GeoJSON } from "geojson";
import * as maplibregl from "maplibre-gl";
import indiaBoundary from "./data/india-boundary.json" with { type: "json" };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface MapRendererOptions {
  onReady?: () => void;
}

export class MapRenderer {
  private readonly map: maplibregl.Map;

  // What the last successful render drew (see drawScene.ts).
  private current: RenderedState | null = null;
  private generation = 0;
  private narrative = "";

  private readonly factories: MarkerFactories = {
    createMarker: (marker) => {
      const mapMarker = new maplibregl.Marker({
        color: marker.color,
        scale: marker.size,
      })
        .setLngLat(marker.position)
        .addTo(this.map);

      const element = mapMarker.getElement();
      element.style.cursor = "pointer";
      element.title = marker.name;
      element.addEventListener("click", () => {
        const detail = snippetForPlace(marker.name, this.narrative);
        const body = detail
          ? `<strong>${escapeHtml(marker.name)}</strong><p style="margin:8px 0 0;font-size:13px;line-height:1.45">${escapeHtml(detail)}</p>`
          : `<strong>${escapeHtml(marker.name)}</strong>`;
        new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "280px" })
          .setLngLat(marker.position)
          .setHTML(body)
          .addTo(this.map);
      });

      if (marker.opacity < 1) {
        element.style.opacity = String(marker.opacity);
      }
      return mapMarker;
    },

    createLabel: (label) => {
      const element = document.createElement("div");
      element.textContent = label.text;
      Object.assign(element.style, labelCss(label));

      return new maplibregl.Marker({ element })
        .setLngLat(label.position)
        .addTo(this.map);
    },
  };

  private isMapLoaded = false;
  private pendingScene: Scene | null = null;

  // Permanent India boundary layer
  private readonly indiaBoundarySourceId =
    "india-boundary";

  private readonly indiaBoundaryLayerId =
    "india-boundary-line";

  constructor(container: HTMLDivElement, options?: MapRendererOptions) {
    this.map = new maplibregl.Map({
      container,

      // Keep your normal basemap here.
      style:
        "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",

      center: [77.2090, 28.6139],
      zoom: 5,
    });

    this.map.on("load", () => {
      this.isMapLoaded = true;

      // --------------------------------------------------
      // STEP 5:
      // Add the official India boundary GeoJSON.
      // This layer stays permanently on the map.
      // --------------------------------------------------

      this.addIndiaBoundary();

      options?.onReady?.();

      const scene = this.pendingScene;
      this.pendingScene = null;

      if (scene) {
        try {
          this.render(scene);
        } catch (error) {
          console.error("Failed to render the pending scene", error);
        }
      }
    });
  }

  /**
   * Adds the official Survey of India boundary
   * as a permanent MapLibre GeoJSON layer.
   */
  private addIndiaBoundary(): void {
    // Prevent duplicate source/layer creation.
    if (this.map.getSource(this.indiaBoundarySourceId)) {
      return;
    }

    this.map.addSource(this.indiaBoundarySourceId, {
      type: "geojson",
      data: indiaBoundary as GeoJSON,
    });

    /*
     * Add the boundary as a line.

     * It is deliberately NOT part of renderedPolygons,
     * so clearMap() will never remove it.
     */
    this.map.addLayer({
      id: this.indiaBoundaryLayerId,
      type: "line",
      source: this.indiaBoundarySourceId,
      layout: {
        visibility: "visible",
      },

      paint: {
        "line-color": "#333333",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],

          // Thin at world view
          3,
          1,

          // Slightly stronger when zoomed in
          6,
          1.5,

          10,
          2,
        ],

        "line-opacity": 0.9,
      },
    });
  }

  /**
   * Draws the scene. Transactional: if drawing fails the previous map is
   * left exactly as it was and the error is rethrown.
   *
   * Only AI-generated objects are replaced; the official India boundary
   * remains untouched.
   */
  public setNarrative(text: string): void {
    this.narrative = text;
  }

  public render(scene: Scene): void {
    if (!this.isMapLoaded) {
      this.pendingScene = scene;
      return;
    }

    this.generation += 1;
    this.current = applyScene(
      this.map,
      this.factories,
      this.current,
      scene,
      this.generation
    );
  }

  public destroy(): void {
    if (this.current) {
      disposeState(this.map, this.current);
      this.current = null;
    }

    // -------------------------
    // India boundary
    // -------------------------

    if (
      this.map.getLayer(
        this.indiaBoundaryLayerId
      )
    ) {
      this.map.removeLayer(
        this.indiaBoundaryLayerId
      );
    }

    if (
      this.map.getSource(
        this.indiaBoundarySourceId
      )
    ) {
      this.map.removeSource(
        this.indiaBoundarySourceId
      );
    }

    this.map.remove();
  }
}