import { MAP_RESOURCE_URI } from "../resources/mapResource.js";
export function registerRenderSceneTool(server, context, sceneSerializer) {
    server.registerTool("renderScene", {
        description: "Render the current scene.",
        _meta: {
            ui: {
                resourceUri: MAP_RESOURCE_URI,
            },
        },
    }, async () => {
        const serializedScene = sceneSerializer.serialize(context.scene);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(serializedScene),
                },
            ],
        };
    });
}
//# sourceMappingURL=renderScene.js.map