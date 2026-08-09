import { Animation } from "../Animation.js";
import { Metadata } from "../Metadata.js";
import { Style } from "../Style.js";
import { PolygonGeometry } from "../geometry/PolygonGeometry.js";
import { DrawableObject } from "./DrawableObject.js";

/**
 * Represents a drawable polygon.
 */
export class Polygon extends DrawableObject {
  constructor(
    id: string,
    visible: boolean,
    style: Style,
    metadata: Metadata,
    animation: Animation,
    public readonly geometry: PolygonGeometry
  ) {
    super(id, visible, style, metadata, animation);
  }
}