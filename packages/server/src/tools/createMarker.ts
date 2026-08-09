import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { RequestContext } from "../RequestContext.js";
import { GeocodingService } from "../services/GeocodingService.js";

import {
  Animation,
  Metadata,
  Style,
} from "@map-renderer/shared";

export function registerCreateMarkerTool(
  server: McpServer,
  context: RequestContext,
  geocodingService: GeocodingService
): void {
  server.registerTool(
    "createMarker",
    {
      description:
        "Create a marker on the map. If the location is a recognizable land location, provide its country as a view-context hint (for example, Delhi -> India, Paris -> France, Tokyo -> Japan). If the country is uncertain, use the best-known country only when reasonably confident. If the location is not meaningfully associated with a country (for example, an ocean location, open sea, or ambiguous geographic point), use 'VAGUE'. Do not fabricate a country. The country value only affects the camera view and does not change the marker's coordinates.",

      inputSchema: z.object({
        location: z.string(),
        country: z.string().optional(),
      }),
    },

    async ({ location, country }) => {
      const point = await geocodingService.getCoordinates(location);

      context.sceneBuilder.createMarker(
        crypto.randomUUID(),
        true,
        new Style("#ff0000", 1, 2),
        new Metadata(location, ""),
        new Animation(false, 0),
        point,
        country
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