import { Animation } from "../Animation.js";
import { Metadata } from "../Metadata.js";
import { Style } from "../Style.js";

/**
 * Base class for every drawable object.
 */
export abstract class DrawableObject {
  constructor(
    public readonly id: string,
    public readonly visible: boolean,
    public readonly style: Style,
    public readonly metadata: Metadata,
    public readonly animation: Animation
  ) {}
}