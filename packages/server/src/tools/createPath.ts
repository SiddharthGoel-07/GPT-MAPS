import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { RequestContext } from "../RequestContext.js";
import { GeocodingService } from "../services/GeocodingService.js";
import { RoutingService } from "../services/RoutingService.js";
import { addPath, hasPath } from "../sceneOps.js";

export function registerCreatePathTool(
  server: McpServer,
  context: RequestContext,
  geocodingService: GeocodingService,
  routingService: RoutingService
): void {
  server.registerTool(
    "createPath",
    {
      description:
        "Draw a driving route between two places. For more than two stops, call it once per consecutive pair. " +
        "Safe to call twice: an identical path is ignored. Does not add markers or labels.",

      inputSchema: z.object({
        start: z.string().trim().min(1).max(200),
        end: z.string().trim().min(1).max(200),
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

      // Skip the routing request entirely if this exact path is already in the scene.
      const line = hasPath(context, startPoint, endPoint)
        ? null
        : await routingService.getRoute(startPoint, endPoint);

      // addPath re-checks synchronously, so two parallel identical calls cannot both insert.
      const text = addPath(context, start, end, startPoint, endPoint, line, style);

      return { content: [{ type: "text", text }] };
    }
  );
}
