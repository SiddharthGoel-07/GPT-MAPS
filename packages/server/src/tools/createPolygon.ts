import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { RequestContext } from "../RequestContext.js";
import { BoundaryService } from "../services/BoundaryService.js";

import {
  Animation,
  Metadata,
  Style,
} from "@map-renderer/shared";

export function registerCreatePolygonTool(
  server: McpServer,
  context: RequestContext,
  boundaryService: BoundaryService
): void {
  server.registerTool(
    "createPolygon",
    {
      description: "Create a polygon on the map.",

      inputSchema: z.object({
        location: z.string(),
      }),
    },

    async ({ location }) => {
      const polygon = await boundaryService.getBoundary(location);

      context.sceneBuilder.createPolygon(
        crypto.randomUUID(),
        true,
        new Style("#00aa00", 0.4, 2),
        new Metadata(location, ""),
        new Animation(false, 0),
        polygon
      );

      console.error(context.scene);

      return {
        content: [
          {
            type: "text",
            text: `Scene now contains ${context.scene.getObjects().length} object(s).`,
          },
        ],
      };
    }
  );
}