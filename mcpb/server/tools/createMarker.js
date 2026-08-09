import * as z from "zod/v4";
import { Animation, Metadata, Style, } from "@map-renderer/shared";
export function registerCreateMarkerTool(server, context, geocodingService) {
    server.registerTool("createMarker", {
        description: "Create a marker on the map.",
        inputSchema: z.object({
            location: z.string(),
        }),
    }, async ({ location }) => {
        const point = await geocodingService.getCoordinates(location);
        context.sceneBuilder.createMarker(crypto.randomUUID(), true, new Style("#ff0000", 1, 2), new Metadata(location, ""), new Animation(false, 0), point);
        console.error(context.scene);
        return {
            content: [
                {
                    type: "text",
                    text: `Scene now contains ${context.scene.getObjects().length} object(s).`,
                },
            ],
        };
    });
}
//# sourceMappingURL=createMarker.js.map