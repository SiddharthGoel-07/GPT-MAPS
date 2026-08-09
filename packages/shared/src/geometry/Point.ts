import { Geometry } from "./Geometry.js";

/**
 * Represents a single geographic coordinate.
 */
export class Point extends Geometry {
  constructor(
    public readonly latitude: number,
    public readonly longitude: number
  ) {
    super();
  }
}