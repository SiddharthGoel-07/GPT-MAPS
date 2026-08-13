import { McpServer } from "@modelcontextprotocol/server";

import { RequestContext } from "../RequestContext.js";
import { SceneSerializer } from "../SceneSerializer.js";

export function registerRenderSceneTool(
  server: McpServer,
  context: RequestContext,
  sceneSerializer: SceneSerializer
): void {
  server.registerTool(
    "renderScene",
    {
      description: "Render the current scene.",
    },

    async () => {
      const serializedScene =
        sceneSerializer.serialize(context.scene);

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