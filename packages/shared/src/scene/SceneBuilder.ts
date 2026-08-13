import { Animation } from "../Animation.js";
import { Metadata } from "../Metadata.js";
import { Style } from "../Style.js";
import { LineString } from "../geometry/LineString.js";
import { Point } from "../geometry/Point.js";
import { PolygonGeometry } from "../geometry/PolygonGeometry.js";
import { Marker } from "../objects/Marker.js";
import { Path } from "../objects/Path.js";
import { Polygon } from "../objects/Polygon.js";
import { Scene } from "./Scene.js";

/**
 * The only class responsible for modifying a Scene.
 */
export class SceneBuilder {
  constructor(private readonly scene: Scene) {}
  
  public getScene(): Scene {
  return this.scene;
}
  createMarker(
    id: string,
    visible: boolean,
    style: Style,
    metadata: Metadata,
    animation: Animation,
    geometry: Point
  ): Marker {
    const marker = new Marker(
      id,
      visible,
      style,
      metadata,
      animation,
      geometry
    );

    this.scene.addObject(marker);
    return marker;
  }

  createPath(
    id: string,
    visible: boolean,
    style: Style,
    metadata: Metadata,
    animation: Animation,
    geometry: LineString
  ): Path {
    const path = new Path(
      id,
      visible,
      style,
      metadata,
      animation,
      geometry
    );

    this.scene.addObject(path);
    return path;
  }

  createPolygon(
    id: string,
    visible: boolean,
    style: Style,
    metadata: Metadata,
    animation: Animation,
    geometry: PolygonGeometry
  ): Polygon {
    const polygon = new Polygon(
      id,
      visible,
      style,
      metadata,
      animation,
      geometry
    );

    this.scene.addObject(polygon);
    return polygon;
  }
}