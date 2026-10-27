import { parseScene } from "@map-renderer/shared";
import type { Scene } from "@map-renderer/shared";

export class SceneSerializer {
  /**
   * Validates against the shared schema before anything leaves the server.
   * Throws SceneValidationError if the scene is invalid.
   */
  public serialize(scene: Scene): Scene {
    return parseScene(scene);
  }
}
