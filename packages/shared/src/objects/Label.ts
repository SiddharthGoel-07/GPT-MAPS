import { Animation } from "../Animation.js";
import { Metadata } from "../Metadata.js";
import { Style } from "../Style.js";
import { Point } from "../geometry/Point.js";
import { DrawableObject } from "./DrawableObject.js";

/**
 * Represents a text label anchored to a point on the map.
 */
export class Label extends DrawableObject {
  constructor(
    id: string,
    visible: boolean,
    style: Style,
    metadata: Metadata,
    animation: Animation,
    public readonly geometry: Point,
    public readonly text: string
  ) {
    super(id, visible, style, metadata, animation);
  }
}