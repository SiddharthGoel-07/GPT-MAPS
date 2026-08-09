import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();

  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error("Map Renderer MCP Server started.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});