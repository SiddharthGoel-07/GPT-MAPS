import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { RequestContext } from "../RequestContext.js";
import { GeocodingService } from "../services/GeocodingService.js";
import { RoutingService } from "../services/RoutingService.js";

import {
  Animation,
  Metadata,
  Style,
} from "@map-renderer/shared";

export function registerCreatePathTool(
  server: McpServer,
  context: RequestContext,
  geocodingService: GeocodingService,
  routingService: RoutingService
): void {
  server.registerTool(
    "createPath",
    {
      description: "Create a path on the map.",

      inputSchema: z.object({
        start: z.string(),
        end: z.string(),
        style: z
          .object({
            color: z.string().optional(),
            width: z.number().optional(),
            opacity: z.number().min(0).max(1).optional(),
            dash: z.boolean().optional(),
          })
          .optional(),
      }),
    },

    async ({ start, end, style }) => {
      const startPoint = await geocodingService.getCoordinates(start);
      const endPoint = await geocodingService.getCoordinates(end);

      const line = await routingService.getRoute(
        startPoint,
        endPoint
      );

      context.sceneBuilder.createPath(
        crypto.randomUUID(),
        true,
        new Style(
          style?.color ?? "#0066ff",
          style?.opacity ?? 1,
          style?.width ?? 4,
          {
            dash: style?.dash,
          }
        ),
        new Metadata(`${start} → ${end}`, ""),
        new Animation(false, 0),
        line
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