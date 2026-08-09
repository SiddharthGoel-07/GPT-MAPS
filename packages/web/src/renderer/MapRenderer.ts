import { Marker, Path, Polygon, Scene } from "@map-renderer/shared";
import maplibregl from "maplibre-gl";

export class MapRenderer {
  private readonly map: maplibregl.Map;

  private readonly renderedMarkers = new Map<string, maplibregl.Marker>();
  private readonly renderedPaths = new Set<string>();
  private readonly renderedPolygons = new Set<string>();

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
    this.renderWithCountryContext(scene, null);
  }

  public renderWithCountryContext(
    scene: Scene,
    countryBounds: Record<string, { minLat: number; maxLat: number; minLon: number; maxLon: number }> | null
  ): void {
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
      }
    }

    this.fitCameraToScene(scene, countryBounds);
  }

  private clearMap(): void {
    for (const marker of this.renderedMarkers.values()) {
      marker.remove();
    }
    this.renderedMarkers.clear();

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
    })
      .setLngLat([
        marker.geometry.longitude,
        marker.geometry.latitude,
      ])
      .addTo(this.map);

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

    this.map.addLayer({
      id: path.id,
      type: "line",
      source: path.id,
      paint: {
        "line-color": path.style.color,
        "line-width": path.style.width,
        "line-opacity": path.style.opacity,
      },
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

    this.map.addLayer({
      id: polygon.id,
      type: "fill",
      source: polygon.id,
      paint: {
        "fill-color": polygon.style.color,
        "fill-opacity": polygon.style.opacity,
      },
    });

    this.renderedPolygons.add(polygon.id);
  }

  private fitCameraToScene(
    scene: Scene,
    countryBounds: Record<string, { minLat: number; maxLat: number; minLon: number; maxLon: number }> | null
  ): void {
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
      }
    }

    if (countryBounds) {
      for (const country of Object.keys(countryBounds)) {
        const bbox = countryBounds[country];
        if (bbox) {
          bounds.extend([bbox.minLon, bbox.minLat]);
          bounds.extend([bbox.maxLon, bbox.maxLat]);
          hasBounds = true;
        }
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