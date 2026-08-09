import * as z from "zod/v4";
import { Animation, Metadata, Style, } from "@map-renderer/shared";
export function registerCreatePathTool(server, context, geocodingService, routingService) {
    server.registerTool("createPath", {
        description: "Create a path on the map.",
        inputSchema: z.object({
            start: z.string(),
            end: z.string(),
        }),
    }, async ({ start, end }) => {
        const startPoint = await geocodingService.getCoordinates(start);
        const endPoint = await geocodingService.getCoordinates(end);
        const line = await routingService.getRoute(startPoint, endPoint);
        context.sceneBuilder.createPath(crypto.randomUUID(), true, new Style("#0066ff", 1, 4), new Metadata(`${start} → ${end}`, ""), new Animation(false, 0), line);
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
//# sourceMappingURL=createPath.js.map