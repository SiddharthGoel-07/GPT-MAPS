import { McpServer } from "@modelcontextprotocol/server";
import { registerCreateMarkerTool } from "./tools/createMarker.js";
import { registerCreatePathTool } from "./tools/createPath.js";
import { registerCreatePolygonTool } from "./tools/createPolygon.js";
import { registerRenderSceneTool } from "./tools/renderScene.js";
import { GeocodingService } from "./services/GeocodingService.js";
import { RoutingService } from "./services/RoutingService.js";
import { BoundaryService } from "./services/BoundaryService.js";
import { registerMapResource } from "./resources/mapResource.js";
import { SceneSerializer } from "./SceneSerializer.js";
import { Scene, SceneBuilder, } from "@map-renderer/shared";
import { RequestContext } from "./RequestContext.js";
const context = new RequestContext();
const scene = new Scene();
const sceneBuilder = new SceneBuilder(scene);
const geocodingService = new GeocodingService();
const routingService = new RoutingService();
const boundaryService = new BoundaryService();
const sceneSerializer = new SceneSerializer();
export function createServer() {
    const server = new McpServer({
        name: "@map-renderer/server",
        version: "0.1.0",
    });
    registerMapResource(server);
    registerCreateMarkerTool(server, context, geocodingService);
    registerCreatePathTool(server, context, geocodingService, routingService);
    registerCreatePolygonTool(server, context, boundaryService);
    registerRenderSceneTool(server, context, sceneSerializer);
    return server;
}
//# sourceMappingURL=server.js.map