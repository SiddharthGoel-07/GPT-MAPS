import { Marker, Path, Polygon, } from "@map-renderer/shared";
export class SceneSerializer {
    serialize(scene) {
        return {
            objects: scene.getObjects().map((object) => {
                if (object instanceof Marker) {
                    return {
                        type: "marker",
                        id: object.id,
                        visible: object.visible,
                        style: object.style,
                        metadata: object.metadata,
                        animation: object.animation,
                        geometry: object.geometry,
                    };
                }
                if (object instanceof Path) {
                    return {
                        type: "path",
                        id: object.id,
                        visible: object.visible,
                        style: object.style,
                        metadata: object.metadata,
                        animation: object.animation,
                        geometry: object.geometry,
                    };
                }
                if (object instanceof Polygon) {
                    return {
                        type: "polygon",
                        id: object.id,
                        visible: object.visible,
                        style: object.style,
                        metadata: object.metadata,
                        animation: object.animation,
                        geometry: object.geometry,
                    };
                }
                throw new Error("Unsupported scene object.");
            }),
        };
    }
}
//# sourceMappingURL=SceneSerializer.js.map