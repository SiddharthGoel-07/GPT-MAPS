import fs from "node:fs/promises";
import path from "node:path";
export const MAP_RESOURCE_URI = "ui://map/index.html";
export function registerMapResource(server) {
    server.registerResource("map-ui", MAP_RESOURCE_URI, {
        title: "Map Renderer",
        mimeType: "text/html;profile=mcp-app",
        _meta: {
            ui: {
                csp: {
                    connectDomains: ["https://demotiles.maplibre.org"],
                },
            },
        },
    }, async () => {
        const html = await fs.readFile(path.resolve(import.meta.dirname, "../../web/dist/index.html"), "utf-8");
        return {
            contents: [
                {
                    uri: MAP_RESOURCE_URI,
                    mimeType: "text/html;profile=mcp-app",
                    text: html,
                    _meta: {
                        ui: {
                            csp: {
                                connectDomains: ["https://demotiles.maplibre.org"],
                            },
                        },
                    },
                },
            ],
        };
    });
}
//# sourceMappingURL=mapResource.js.map