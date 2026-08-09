import { useEffect, useRef } from "react";

import {
  Animation,
  Metadata,
  Point,
  Scene,
  SceneBuilder,
  Style,
  LineString,
  PolygonGeometry,
} from "@map-renderer/shared";

import { MapRenderer } from "../renderer/MapRenderer.js";
import { RendererContext } from "../RendererContext.js";

export function MapView() {
  const mapContainer = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    const renderer = new MapRenderer(mapContainer.current);
    RendererContext.renderer = renderer;

    const scene = new Scene();
    const sceneBuilder = new SceneBuilder(scene);

    sceneBuilder.createMarker(
      "marker-1",
      true,
      new Style("#ff0000", 1, 2),
      new Metadata("Delhi", "Capital of India"),
      new Animation(false, 0),
      new Point(28.6139, 77.2090)
    );

    sceneBuilder.createPath(
      "path-1",
      true,
      new Style("#0066ff", 1, 4),
      new Metadata("Delhi to Jaipur", "Sample path"),
      new Animation(false, 0),
      new LineString([
        new Point(28.6139, 77.2090), // Delhi
        new Point(26.9124, 75.7873), // Jaipur
      ])
    );

    sceneBuilder.createPolygon(
      "polygon-1",
      true,
      new Style("#00aa00", 0.4, 1),
      new Metadata("Sample Region", "Demo polygon"),
      new Animation(false, 0),
      new PolygonGeometry([
        new Point(28.80, 77.00),
        new Point(28.80, 77.40),
        new Point(28.50, 77.40),
        new Point(28.50, 77.00),
      ])
    );

    renderer.renderWithCountryContext(scene, null);

    return () => {
      RendererContext.renderer = null;
      renderer.destroy();
    };
  }, []);

  return (
    <div
      ref={mapContainer}
      style={{
        width: "100%",
        height: "100vh",
      }}
    />
  );
}