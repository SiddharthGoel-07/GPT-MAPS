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

      context.sceneBuilder.createPolygon(
        crypto.randomUUID(),
        true,
        new Style(
          style?.fillColor ?? "#00aa00",
          style?.fillOpacity ?? 0.4,
          style?.borderWidth ?? 2,
          {
            fillColor: style?.fillColor,
            fillOpacity: style?.fillOpacity,
            borderColor: style?.borderColor,
            borderWidth: style?.borderWidth,
            borderDash: style?.borderDash,
          }
        ),
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