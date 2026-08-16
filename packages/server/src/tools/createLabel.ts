import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { RequestContext } from "../RequestContext.js";
import { GeocodingService } from "../services/GeocodingService.js";

import {
  Animation,
  Metadata,
  Style,
} from "@map-renderer/shared";

export function registerCreateLabelTool(
  server: McpServer,
  context: RequestContext,
  geocodingService: GeocodingService
): void {
  server.registerTool(
    "createLabel",
    {
      description: "Create a text label on the map at a location.",

      inputSchema: z.object({
        location: z.string(),
        text: z.string(),
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

      context.sceneBuilder.createLabel(
        crypto.randomUUID(),
        true,
        new Style(
          style?.color ?? "#000000",
          style?.opacity ?? 1,
          1,
          {
            fontSize: style?.fontSize,
            fontWeight: style?.fontWeight,
            backgroundColor: style?.backgroundColor,
          }
        ),
        new Metadata(location, ""),
        new Animation(false, 0),
        point,
        text
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