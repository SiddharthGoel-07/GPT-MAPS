import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { RequestContext } from "../RequestContext.js";
import { removeObjects } from "../sceneOps.js";

export function registerRemoveObjectTool(server: McpServer, context: RequestContext): void {
  server.registerTool(
    "removeObject",
    {
      description:
        "Remove things from the map by name, e.g. a place (its marker and label), a region, or a path named " +
        "'Delhi → Jaipur'. Use the names listed in the current map. Optionally restrict to one type. " +
        "To change the style of something, remove it and create it again.",

      inputSchema: z.object({
        name: z.string().trim().min(1).max(300),
        type: z.enum(["marker", "label", "path", "polygon"]).optional(),
      }),
    },

    async ({ name, type }) => ({
      content: [{ type: "text", text: removeObjects(context, name, type) }],
    })
  );
}
