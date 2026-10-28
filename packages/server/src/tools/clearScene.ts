import { McpServer } from "@modelcontextprotocol/server";

import { RequestContext } from "../RequestContext.js";
import { clearScene } from "../sceneOps.js";

export function registerClearSceneTool(server: McpServer, context: RequestContext): void {
  server.registerTool(
    "clearScene",
    {
      description:
        "Remove EVERYTHING from the map. Use it only when the user wants to start over or replace the whole map. " +
        "Then create whatever the user asks for next.",
    },

    async () => ({ content: [{ type: "text", text: clearScene(context) }] })
  );
}
