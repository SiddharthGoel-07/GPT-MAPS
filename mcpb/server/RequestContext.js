import { Scene, SceneBuilder } from "@map-renderer/shared";
export class RequestContext {
    scene;
    sceneBuilder;
    constructor() {
        this.scene = new Scene();
        this.sceneBuilder = new SceneBuilder(this.scene);
    }
}
//# sourceMappingURL=RequestContext.js.map