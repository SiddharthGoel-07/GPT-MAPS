/**
 * Optional style properties that are specific to certain drawable
 * object types. These are additive and never required.
 */
export interface StyleOptions {
  /** Marker scale (size multiplier). */
  size?: number | undefined;
  /** Path: render as a dashed line. */
  dash?: boolean | undefined;
  /** Polygon: explicit fill color override. */
  fillColor?: string | undefined;
  /** Polygon: explicit fill opacity override. */
  fillOpacity?: number | undefined;
  /** Polygon: border color. */
  borderColor?: string | undefined;
  /** Polygon: border width. */
  borderWidth?: number | undefined;
  /** Polygon: render border as a dashed line. */
  borderDash?: boolean | undefined;
  /** Label: font size in pixels. */
  fontSize?: number | undefined;
  /** Label: font weight (e.g. "normal", "bold"). */
  fontWeight?: string | undefined;
  /** Label: background color. */
  backgroundColor?: string | undefined;
}

/**
 * Represents the visual appearance of any drawable object.
 *
 * Every drawable object (Marker, Path, Polygon, Label, etc.)
 * owns a Style instance.
 *
 * This is a value object and is immutable.
 */
export class Style {
  constructor(
    public readonly color: string,
    public readonly opacity: number,
    public readonly width: number,
    public readonly options: StyleOptions = {}
  ) {}
}