import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { RequestContext } from "../RequestContext.js";
import { GeocodingService } from "../services/GeocodingService.js";
import { addLabel } from "../sceneOps.js";

export function registerCreateLabelTool(
  server: McpServer,
  context: RequestContext,
  geocodingService: GeocodingService
): void {
  server.registerTool(
    "createLabel",
    {
      description:
        "Put custom text at a location. Markers already get a name label automatically, so use this " +
        "only for extra or different text, or to label a place that has no marker (e.g. a path endpoint). " +
        "There is at most one label per spot: calling it again for the same spot replaces the text.",

      inputSchema: z.object({
        location: z.string().trim().min(1).max(200),
        text: z.string().max(200),
        style: z
          .object({
            color: z.string().optional(),
            fontSize: z.number().optional(),
            fontWeight: z.string().optional(),
            opacity: z.number().min(0).max(1).optional(),
            backgroundColor: z.string().optional(),
          })
          .optional(),
      }),
    },

    async ({ location, text, style }) => {
      const point = await geocodingService.getCoordinates(location);

      const message = addLabel(context, location, point, text, style);

      return { content: [{ type: "text", text: message }] };
    }
  );
}
