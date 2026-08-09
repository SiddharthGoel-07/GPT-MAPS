import { Geometry } from "./Geometry.js";
import { Point } from "./Point.js";

/**
 * Represents a sequence of connected points.
 */
export class LineString extends Geometry {
  constructor(
    public readonly points: readonly Point[]
  ) {
    super();
  }
}