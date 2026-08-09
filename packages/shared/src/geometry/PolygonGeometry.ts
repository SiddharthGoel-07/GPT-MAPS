import { Geometry } from "./Geometry.js";
import { Point } from "./Point.js";

/**
 * Represents a closed polygon boundary.
 */
export class PolygonGeometry extends Geometry {
  constructor(
    public readonly points: readonly Point[]
  ) {
    super();
  }
}