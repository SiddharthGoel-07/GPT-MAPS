import { McpServer } from "@modelcontextprotocol/server";
import { registerCreateMarkerTool } from "./tools/createMarker.js";
import { registerCreatePathTool } from "./tools/createPath.js";
import { registerCreatePolygonTool } from "./tools/createPolygon.js";
import { registerRenderSceneTool } from "./tools/renderScene.js";
import { GeocodingService } from "./services/GeocodingService.js";
import { RoutingService } from "./services/RoutingService.js";
import { BoundaryService } from "./services/BoundaryService.js";
import { SceneSerializer } from "./SceneSerializer.js";

import { RequestContext } from "./RequestContext.js";

const context = new RequestContext();
const geocodingService = new GeocodingService();
const routingService = new RoutingService();
const boundaryService = new BoundaryService();
const sceneSerializer = new SceneSerializer();

export function createServer(): McpServer {
  const server = new McpServer({
    name: "@map-renderer/server",
    version: "0.1.0",
  });

  // The AI server creates a NEW MCP client for every independent chat
  // request. Each new client completes the `initialize` handshake, which
  // fires `oninitialized` on the underlying Server. Resetting the
  // RequestContext here guarantees that every independent request starts
  // with a fresh Scene, while all tool calls belonging to that request
  // share the same Scene via the shared context.
  server.server.oninitialized = () => {
    context.reset();
  };

  registerCreateMarkerTool(server, context, geocodingService);
  registerCreatePathTool(server, context, geocodingService, routingService);
  registerCreatePolygonTool(server, context, boundaryService);
  registerRenderSceneTool(server, context, sceneSerializer);

  return server;
}