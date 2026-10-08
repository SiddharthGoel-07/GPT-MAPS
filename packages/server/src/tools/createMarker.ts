import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { RequestContext } from "../RequestContext.js";
import { GeocodingService } from "../services/GeocodingService.js";
import { addMarker } from "../sceneOps.js";

export function registerCreateMarkerTool(
  server: McpServer,
  context: RequestContext,
  geocodingService: GeocodingService
): void {
  server.registerTool(
    "createMarker",
    {
      description:
        "Place a marker on a named place. A text label with the place name is added automatically " +
        "(pass `label` to use different text, or showLabel=false for no label). " +
        "Safe to call twice: duplicates are ignored, so never repeat a call. " +
        "Only pass `style` if the user asked for specific styling.",

      inputSchema: z.object({
        location: z.string().trim().min(1).max(200),
        label: z.string().max(200).optional(),
        showLabel: z.boolean().optional(),
        style: z
          .object({
            color: z.string().optional(),
            size: z.number().optional(),
            opacity: z.number().min(0).max(1).optional(),
          })
          .optional(),
      }),
    },

    async ({ location, label, showLabel, style }) => {
      const point = await geocodingService.getCoordinates(location);

      // No await between the duplicate check and the insert inside addMarker.
      const text = addMarker(context, location, point, { label, showLabel, style });

      return { content: [{ type: "text", text }] };
    }
  );
}
