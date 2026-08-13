import { Scene, SceneBuilder } from "@map-renderer/shared";

/**
 * Holds the Scene and SceneBuilder for a single request lifecycle.
 *
 * All MCP tool calls belonging to one independent request must operate on
 * the same Scene, while independent requests (new MCP client connections)
 * must start with a fresh Scene.
 *
 * The `reset()` method replaces the Scene/SceneBuilder with brand-new
 * instances, and is invoked when a new MCP client completes its
 * `initialize` handshake with the server.
 */
export class RequestContext {
  public scene: Scene;
  public sceneBuilder: SceneBuilder;

  constructor() {
    this.scene = new Scene();
    this.sceneBuilder = new SceneBuilder(this.scene);
  }

  /**
   * Drops the current Scene and creates a fresh Scene/SceneBuilder pair.
   *
   * Any tool that captured this `RequestContext` instance will read the new
   * `scene` / `sceneBuilder` on its next invocation, because the tools access
   * these via the context object reference at call time.
   */
  public reset(): void {
    this.scene = new Scene();
    this.sceneBuilder = new SceneBuilder(this.scene);
  }
}