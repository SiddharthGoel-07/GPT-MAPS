import {
  Label,
  Marker,
  Path,
  Polygon,
  Scene,
} from "@map-renderer/shared";

import maplibregl from "maplibre-gl";
import indiaBoundary from "./data/india-boundary.json" with { type: "json" };

export class MapRenderer {
  private readonly map: maplibregl.Map;

  private readonly renderedMarkers =
    new Map<string, maplibregl.Marker>();

  private readonly renderedPaths =
    new Set<string>();

  private readonly renderedPolygons =
    new Set<string>();

  private readonly renderedLabels =
    new Map<string, maplibregl.Marker>();

  private isMapLoaded = false;
  private pendingScene: Scene | null = null;

  // Permanent India boundary layer
  private readonly indiaBoundarySourceId =
    "india-boundary";

  private readonly indiaBoundaryLayerId =
    "india-boundary-line";

  constructor(container: HTMLDivElement) {
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

      const scene = this.pendingScene;
      this.pendingScene = null;

      if (scene) {
        this.render(scene);
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
      data: indiaBoundary as GeoJSON.GeoJSON,
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

  public render(scene: Scene): void {
    if (!this.isMapLoaded) {
      this.pendingScene = scene;
      return;
    }

    /*
     * Only remove AI-generated objects.
     *
     * The official India boundary remains untouched.
     */
    this.clearMap();

    for (const object of scene.getObjects()) {
      if (object instanceof Marker) {
        this.renderMarker(object);
      } else if (object instanceof Path) {
        this.renderPath(object);
      } else if (object instanceof Polygon) {
        this.renderPolygon(object);
      } else if (object instanceof Label) {
        this.renderLabel(object);
      }
    }

    this.fitCameraToScene(scene);
  }

  /**
   * Removes only AI-generated map objects.
   *
   * The permanent India boundary is intentionally
   * NOT removed here.
   */
  private clearMap(): void {
    // -------------------------
    // Markers
    // -------------------------

    for (const marker of this.renderedMarkers.values()) {
      marker.remove();
    }

    this.renderedMarkers.clear();

    // -------------------------
    // Labels
    // -------------------------

    for (const label of this.renderedLabels.values()) {
      label.remove();
    }

    this.renderedLabels.clear();

    // -------------------------
    // Paths
    // -------------------------

    for (const pathId of this.renderedPaths) {
      if (this.map.getLayer(pathId)) {
        this.map.removeLayer(pathId);
      }

      if (this.map.getSource(pathId)) {
        this.map.removeSource(pathId);
      }
    }

    this.renderedPaths.clear();

    // -------------------------
    // AI-generated polygons
    // -------------------------

    for (const polygonId of this.renderedPolygons) {
      if (this.map.getLayer(polygonId)) {
        this.map.removeLayer(polygonId);
      }

      /*
       * Polygon border layers have IDs like:
       * polygon-id-border
       *
       * Because those IDs are also stored in
       * renderedPolygons, they are removed here.
       */

      if (this.map.getSource(polygonId)) {
        this.map.removeSource(polygonId);
      }
    }

    /*
     * The previous implementation stores both:
     *
     * polygonId
     * polygonId-border
     *
     * in renderedPolygons.
     *
     * The border uses the same source as the polygon,
     * so after removing the border layer we only need
     * to remove the source once.
     */
    this.renderedPolygons.clear();
  }

  private renderMarker(marker: Marker): void {
    if (this.renderedMarkers.has(marker.id)) {
      return;
    }

    const mapMarker = new maplibregl.Marker({
      color: marker.style.color,

      /*
       * Keep the existing AI styling behaviour.
       */
      scale:
        marker.style.options.size ?? 1,
    })
      .setLngLat([
        marker.geometry.longitude,
        marker.geometry.latitude,
      ])
      .addTo(this.map);

    if (marker.style.opacity < 1) {
      mapMarker
        .getElement()
        .style.opacity =
        String(marker.style.opacity);
    }

    this.renderedMarkers.set(
      marker.id,
      mapMarker
    );
  }

  private renderPath(path: Path): void {
    if (this.renderedPaths.has(path.id)) {
      return;
    }

    const coordinates =
      path.geometry.points.map((point) => [
        point.longitude,
        point.latitude,
      ]);

    this.map.addSource(path.id, {
      type: "geojson",

      data: {
        type: "Feature",

        geometry: {
          type: "LineString",
          coordinates,
        },

        properties: {},
      },
    });

    const paint: maplibregl.LineLayerSpecification["paint"] =
      {
        "line-color":
          path.style.color,

        "line-width":
          path.style.width,

        "line-opacity":
          path.style.opacity,
      };

    if (path.style.options.dash) {
      paint["line-dasharray"] = [4, 2];
    }

    this.map.addLayer({
      id: path.id,

      type: "line",

      source: path.id,

      paint,
    });

    this.renderedPaths.add(path.id);
  }

  private renderPolygon(
    polygon: Polygon
  ): void {
    if (
      this.renderedPolygons.has(
        polygon.id
      )
    ) {
      return;
    }

    const coordinates =
      polygon.geometry.points.map(
        (point) => [
          point.longitude,
          point.latitude,
        ]
      );

    // GeoJSON polygons must be closed.
    if (coordinates.length > 0) {
      const first = coordinates[0]!;
      const last =
        coordinates[
          coordinates.length - 1
        ]!;

      if (
        first[0] !== last[0] ||
        first[1] !== last[1]
      ) {
        coordinates.push([
          ...first,
        ]);
      }
    }

    this.map.addSource(polygon.id, {
      type: "geojson",

      data: {
        type: "Feature",

        geometry: {
          type: "Polygon",

          coordinates: [
            coordinates,
          ],
        },

        properties: {},
      },
    });

    const fillColor =
      polygon.style.options
        .fillColor ??
      polygon.style.color;

    const fillOpacity =
      polygon.style.options
        .fillOpacity ??
      polygon.style.opacity;

    // -------------------------
    // Polygon fill
    // -------------------------

    this.map.addLayer({
      id: polygon.id,

      type: "fill",

      source: polygon.id,

      paint: {
        "fill-color":
          fillColor,

        "fill-opacity":
          fillOpacity,
      },
    });

    // -------------------------
    // Polygon border
    // -------------------------

    const borderColor =
      polygon.style.options
        .borderColor;

    const borderWidth =
      polygon.style.options
        .borderWidth;

    const borderDash =
      polygon.style.options
        .borderDash;

    if (
      borderColor !== undefined ||
      borderWidth !== undefined ||
      borderDash !== undefined
    ) {
      const borderLayerId =
        `${polygon.id}-border`;

      const borderPaint:
        maplibregl.LineLayerSpecification["paint"] =
        {
          "line-color":
            borderColor ??
            fillColor,

          "line-width":
            borderWidth ?? 1,

          "line-opacity": 1,
        };

      if (borderDash) {
        borderPaint[
          "line-dasharray"
        ] = [4, 2];
      }

      this.map.addLayer({
        id: borderLayerId,

        type: "line",

        source: polygon.id,

        paint: borderPaint,
      });

      this.renderedPolygons.add(
        borderLayerId
      );
    }

    this.renderedPolygons.add(
      polygon.id
    );
  }

  private renderLabel(
    label: Label
  ): void {
    if (
      this.renderedLabels.has(
        label.id
      )
    ) {
      return;
    }

    const element =
      document.createElement(
        "div"
      );

    element.textContent =
      label.text;

    element.style.color =
      label.style.color;

    element.style.fontSize =
      `${
        label.style.options
          .fontSize ?? 14
      }px`;

    element.style.fontWeight =
      label.style.options
        .fontWeight ??
      "normal";

    element.style.opacity =
      String(
        label.style.opacity
      );

    element.style.backgroundColor =
      label.style.options
        .backgroundColor ??
      "rgba(255, 255, 255, 0.7)";

    element.style.padding =
      "2px 6px";

    element.style.borderRadius =
      "4px";

    element.style.whiteSpace =
      "nowrap";

    element.style.transform =
      "translate(-50%, -100%)";

    const mapMarker =
      new maplibregl.Marker({
        element,
      })
        .setLngLat([
          label.geometry.longitude,
          label.geometry.latitude,
        ])
        .addTo(this.map);

    this.renderedLabels.set(
      label.id,
      mapMarker
    );
  }

  private fitCameraToScene(
    scene: Scene
  ): void {
    const bounds =
      new maplibregl.LngLatBounds();

    let hasBounds = false;

    for (const object of scene.getObjects()) {
      if (
        object instanceof Marker
      ) {
        bounds.extend([
          object.geometry.longitude,
          object.geometry.latitude,
        ]);

        hasBounds = true;
      }

      else if (
        object instanceof Path
      ) {
        for (
          const point of
            object.geometry.points
        ) {
          bounds.extend([
            point.longitude,
            point.latitude,
          ]);

          hasBounds = true;
        }
      }

      else if (
        object instanceof Polygon
      ) {
        for (
          const point of
            object.geometry.points
        ) {
          bounds.extend([
            point.longitude,
            point.latitude,
          ]);

          hasBounds = true;
        }
      }

      else if (
        object instanceof Label
      ) {
        bounds.extend([
          object.geometry.longitude,
          object.geometry.latitude,
        ]);

        hasBounds = true;
      }
    }

    if (hasBounds) {
      this.map.fitBounds(
        bounds,
        {
          padding: 50,
        }
      );
    }
  }

  public destroy(): void {
    // -------------------------
    // Markers
    // -------------------------

    for (
      const marker of
        this.renderedMarkers.values()
    ) {
      marker.remove();
    }

    this.renderedMarkers.clear();

    // -------------------------
    // Labels
    // -------------------------

    for (
      const label of
        this.renderedLabels.values()
    ) {
      label.remove();
    }

    this.renderedLabels.clear();

    // -------------------------
    // Paths
    // -------------------------

    for (
      const pathId of
        this.renderedPaths
    ) {
      if (
        this.map.getLayer(pathId)
      ) {
        this.map.removeLayer(
          pathId
        );
      }

      if (
        this.map.getSource(pathId)
      ) {
        this.map.removeSource(
          pathId
        );
      }
    }

    this.renderedPaths.clear();

    // -------------------------
    // AI polygons
    // -------------------------

    for (
      const polygonId of
        this.renderedPolygons
    ) {
      if (
        this.map.getLayer(
          polygonId
        )
      ) {
        this.map.removeLayer(
          polygonId
        );
      }

      /*
       * IMPORTANT:
       * Don't accidentally remove the
       * permanent India boundary source.
       */
      if (
        polygonId !==
        this.indiaBoundaryLayerId &&
        this.map.getSource(
          polygonId
        )
      ) {
        this.map.removeSource(
          polygonId
        );
      }
    }

    this.renderedPolygons.clear();

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