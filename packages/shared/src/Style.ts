/**
 * Represents the visual appearance of any drawable object.
 *
 * Every drawable object (Marker, Path, Polygon, etc.)
 * owns a Style instance.
 *
 * This is a value object and is immutable.
 */
export class Style {
  constructor(
    public readonly color: string,
    public readonly opacity: number,
    public readonly width: number
  ) {}
}