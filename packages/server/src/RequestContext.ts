import { Scene, SceneBuilder } from "@map-renderer/shared";

export class RequestContext {
  public readonly scene: Scene;
  public readonly sceneBuilder: SceneBuilder;

  constructor() {
    this.scene = new Scene();
    this.sceneBuilder = new SceneBuilder(this.scene);
  }
}