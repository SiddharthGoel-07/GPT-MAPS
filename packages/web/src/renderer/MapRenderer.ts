import { Label, Marker, Path, Polygon, Scene } from "@map-renderer/shared";
import maplibregl from "maplibre-gl";

export class MapRenderer {
  private readonly map: maplibregl.Map;

  private readonly renderedMarkers = new Map<string, maplibregl.Marker>();
  private readonly renderedPaths = new Set<string>();
  private readonly renderedPolygons = new Set<string>();
  private readonly renderedLabels = new Map<string, maplibregl.Marker>();

  private isMapLoaded = false;
  private pendingScene: Scene | null = null;

  constructor(container: HTMLDivElement) {
    this.map = new maplibregl.Map({
      container,
      style: "https://demotiles.maplibre.org/style.json",
      center: [77.2090, 28.6139],
      zoom: 5,
    });

    this.map.on("load", () => {
      this.isMapLoaded = true;

      const scene = this.pendingScene;
      this.pendingScene = null;

      if (scene) {
        this.render(scene);
      }
    });
  }

  public render(scene: Scene): void {
    if (!this.isMapLoaded) {
      this.pendingScene = scene;
      return;
    }

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

  private clearMap(): void {
    for (const marker of this.renderedMarkers.values()) {
      marker.remove();
    }
    this.renderedMarkers.clear();

    for (const label of this.renderedLabels.values()) {
      label.remove();
    }
    this.renderedLabels.clear();

    for (const pathId of this.renderedPaths) {
      if (this.map.getLayer(pathId)) {
        this.map.removeLayer(pathId);
      }
      if (this.map.getSource(pathId)) {
        this.map.removeSource(pathId);
      }
    }
    this.renderedPaths.clear();

    for (const polygonId of this.renderedPolygons) {
      if (this.map.getLayer(polygonId)) {
        this.map.removeLayer(polygonId);
      }
      if (this.map.getSource(polygonId)) {
        this.map.removeSource(polygonId);
      }
    }
    this.renderedPolygons.clear();
  }

  private renderMarker(marker: Marker): void {
    if (this.renderedMarkers.has(marker.id)) {
      return;
    }

    const mapMarker = new maplibregl.Marker({
      color: marker.style.color,
      scale: marker.style.options.size ?? 1,
    })
      .setLngLat([
        marker.geometry.longitude,
        marker.geometry.latitude,
      ])
      .addTo(this.map);

    if (marker.style.opacity < 1) {
      mapMarker.getElement().style.opacity = String(marker.style.opacity);
    }

    this.renderedMarkers.set(marker.id, mapMarker);
  }

  private renderPath(path: Path): void {
    if (this.renderedPaths.has(path.id)) {
      return;
    }

    const coordinates = path.geometry.points.map((point) => [
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

    const paint: maplibregl.LineLayerSpecification["paint"] = {
      "line-color": path.style.color,
      "line-width": path.style.width,
      "line-opacity": path.style.opacity,
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

  private renderPolygon(polygon: Polygon): void {
    if (this.renderedPolygons.has(polygon.id)) {
      return;
    }

    const coordinates = polygon.geometry.points.map(point => [
      point.longitude,
      point.latitude,
    ]);

    // GeoJSON polygons must be closed.
    if (coordinates.length > 0) {
      const first = coordinates[0]!;
      const last = coordinates[coordinates.length - 1]!;

      if (
        first[0] !== last[0] ||
        first[1] !== last[1]
      ) {
        coordinates.push([...first]);
      }
    }

    this.map.addSource(polygon.id, {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [coordinates],
        },
        properties: {},
      },
    });

    const fillColor = polygon.style.options.fillColor ?? polygon.style.color;
    const fillOpacity = polygon.style.options.fillOpacity ?? polygon.style.opacity;

    this.map.addLayer({
      id: polygon.id,
      type: "fill",
      source: polygon.id,
      paint: {
        "fill-color": fillColor,
        "fill-opacity": fillOpacity,
      },
    });

    // Add a border (line) layer when border styling is requested.
    const borderColor = polygon.style.options.borderColor;
    const borderWidth = polygon.style.options.borderWidth;
    const borderDash = polygon.style.options.borderDash;

    if (
      borderColor !== undefined ||
      borderWidth !== undefined ||
      borderDash !== undefined
    ) {
      const borderLayerId = `${polygon.id}-border`;
      const borderPaint: maplibregl.LineLayerSpecification["paint"] = {
        "line-color": borderColor ?? fillColor,
        "line-width": borderWidth ?? 1,
        "line-opacity": 1,
      };

      if (borderDash) {
        borderPaint["line-dasharray"] = [4, 2];
      }

      this.map.addLayer({
        id: borderLayerId,
        type: "line",
        source: polygon.id,
        paint: borderPaint,
      });

      this.renderedPolygons.add(borderLayerId);
    }

    this.renderedPolygons.add(polygon.id);
  }

  private renderLabel(label: Label): void {
    if (this.renderedLabels.has(label.id)) {
      return;
    }

    const element = document.createElement("div");
    element.textContent = label.text;
    element.style.color = label.style.color;
    element.style.fontSize = `${label.style.options.fontSize ?? 14}px`;
    element.style.fontWeight = label.style.options.fontWeight ?? "normal";
    element.style.opacity = String(label.style.opacity);
    element.style.backgroundColor =
      label.style.options.backgroundColor ?? "rgba(255, 255, 255, 0.7)";
    element.style.padding = "2px 6px";
    element.style.borderRadius = "4px";
    element.style.whiteSpace = "nowrap";
    element.style.transform = "translate(-50%, -100%)";

    const mapMarker = new maplibregl.Marker({ element })
      .setLngLat([
        label.geometry.longitude,
        label.geometry.latitude,
      ])
      .addTo(this.map);

    this.renderedLabels.set(label.id, mapMarker);
  }

  private fitCameraToScene(scene: Scene): void {
    const bounds = new maplibregl.LngLatBounds();

    let hasBounds = false;

    for (const object of scene.getObjects()) {
      if (object instanceof Marker) {
        bounds.extend([
          object.geometry.longitude,
          object.geometry.latitude,
        ]);
        hasBounds = true;
      } else if (object instanceof Path) {
        for (const point of object.geometry.points) {
          bounds.extend([point.longitude, point.latitude]);
          hasBounds = true;
        }
      } else if (object instanceof Polygon) {
        for (const point of object.geometry.points) {
          bounds.extend([point.longitude, point.latitude]);
          hasBounds = true;
        }
      } else if (object instanceof Label) {
        bounds.extend([
          object.geometry.longitude,
          object.geometry.latitude,
        ]);
        hasBounds = true;
      }
    }

    if (hasBounds) {
      this.map.fitBounds(bounds, {
        padding: 50,
      });
    }
  }

  public destroy(): void {
    for (const marker of this.renderedMarkers.values()) {
      marker.remove();
    }

    this.renderedMarkers.clear();

    for (const label of this.renderedLabels.values()) {
      label.remove();
    }

    this.renderedLabels.clear();

    for (const pathId of this.renderedPaths) {
      if (this.map.getLayer(pathId)) {
        this.map.removeLayer(pathId);
      }

      if (this.map.getSource(pathId)) {
        this.map.removeSource(pathId);
      }
    }

    this.renderedPaths.clear();

    for (const polygonId of this.renderedPolygons.keys()) {
      if (this.map.getLayer(polygonId)) {
        this.map.removeLayer(polygonId);
      }

      if (this.map.getSource(polygonId)) {
        this.map.removeSource(polygonId);
      }
    }

    this.renderedPolygons.clear();
    this.map.remove();
  }
}