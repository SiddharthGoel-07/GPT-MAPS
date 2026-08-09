import { Animation } from "../Animation.js";
import { Metadata } from "../Metadata.js";
import { Style } from "../Style.js";
import { LineString } from "../geometry/LineString.js";
import { DrawableObject } from "./DrawableObject.js";

/**
 * Represents a drawable path.
 */
export class Path extends DrawableObject {
  constructor(
    id: string,
    visible: boolean,
    style: Style,
    metadata: Metadata,
    animation: Animation,
    public readonly geometry: LineString
  ) {
    super(id, visible, style, metadata, animation);
  }
}