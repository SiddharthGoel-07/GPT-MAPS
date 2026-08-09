import { McpServer } from "@modelcontextprotocol/server";

import { RequestContext } from "../RequestContext.js";
import { SceneSerializer } from "../SceneSerializer.js";
import { MAP_RESOURCE_URI } from "../resources/mapResource.js";

export function registerRenderSceneTool(
  server: McpServer,
  context: RequestContext,
  sceneSerializer: SceneSerializer
): void {
  server.registerTool(
    "renderScene",
    {
      description: "Render the current scene.",

      _meta: {
        ui: {
          resourceUri: MAP_RESOURCE_URI,
        },
      },
    },

    async () => {
      const serializedScene =
        await sceneSerializer.serialize(context.scene);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(serializedScene),
          },
        ],
      };
    }
  );
}