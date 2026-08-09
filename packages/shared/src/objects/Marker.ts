import { Animation } from "../Animation.js";
import { Metadata } from "../Metadata.js";
import { Style } from "../Style.js";
import { Point } from "../geometry/Point.js";
import { DrawableObject } from "./DrawableObject.js";

/**
 * Represents a point on the map.
 */
export class Marker extends DrawableObject {
  public readonly country: string | undefined;

  constructor(
    id: string,
    visible: boolean,
    style: Style,
    metadata: Metadata,
    animation: Animation,
    public readonly geometry: Point,
    country?: string
  ) {
    super(id, visible, style, metadata, animation);
    this.country = country;
  }
}
