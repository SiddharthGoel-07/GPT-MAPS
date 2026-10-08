import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { RequestContext } from "../RequestContext.js";
import { BoundaryService } from "../services/BoundaryService.js";
import { addPolygon } from "../sceneOps.js";

export function registerCreatePolygonTool(
  server: McpServer,
  context: RequestContext,
  boundaryService: BoundaryService
): void {
  server.registerTool(
    "createPolygon",
    {
      description:
        "Highlight the boundary of a named region (city, state, country, area). " +
        "Safe to call twice: a duplicate is ignored. Does not add a label; use createLabel if one is wanted.",

      inputSchema: z.object({
        location: z.string().trim().min(1).max(200),
        style: z
          .object({
            fillColor: z.string().optional(),
            fillOpacity: z.number().min(0).max(1).optional(),
            borderColor: z.string().optional(),
            borderWidth: z.number().optional(),
            borderDash: z.boolean().optional(),
          })
          .optional(),
      }),
    },

    async ({ location, style }) => {
      const polygon = await boundaryService.getBoundary(location);

      const text = addPolygon(context, location, polygon, style);

      return { content: [{ type: "text", text }] };
    }
  );
}
