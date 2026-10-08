import { McpServer } from "@modelcontextprotocol/server";
import { registerCreateLabelTool } from "./tools/createLabel.js";
import { registerCreateMarkerTool } from "./tools/createMarker.js";
import { registerCreatePathTool } from "./tools/createPath.js";
import { registerCreatePolygonTool } from "./tools/createPolygon.js";
import { registerRenderSceneTool } from "./tools/renderScene.js";
import { GeocodingService } from "./services/GeocodingService.js";
import { RoutingService } from "./services/RoutingService.js";
import { BoundaryService } from "./services/BoundaryService.js";
import { SceneSerializer } from "./SceneSerializer.js";

import { RequestContext } from "./RequestContext.js";

// Stateless, safe to share between sessions. Scene state is NOT shared:
// every createServer() call builds its own RequestContext (see below).
const geocodingService = new GeocodingService();
const routingService = new RoutingService();
const boundaryService = new BoundaryService();
const sceneSerializer = new SceneSerializer();

export function createServer(): McpServer {
  const server = new McpServer({
    name: "@map-renderer/server",
    version: "0.1.0",
  });

  // One RequestContext (= one Scene) per McpServer instance, and index.ts
  // creates exactly one McpServer per MCP session. Scene isolation therefore
  // follows session isolation; no reset hooks, no shared mutable state.
  const context = new RequestContext();

  registerCreateLabelTool(server, context, geocodingService);
  registerCreateMarkerTool(server, context, geocodingService);
  registerCreatePathTool(server, context, geocodingService, routingService);
  registerCreatePolygonTool(server, context, boundaryService);
  registerRenderSceneTool(server, context, sceneSerializer);

  return server;
}
