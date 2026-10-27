import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpLike } from "./chatLoop.js";

export interface McpConnection {
  mcp: McpLike;
  /** Ends the MCP session on the server, then closes the connection. Never throws. */
  close(): Promise<void>;
}

const CLOSE_TIMEOUT_MS = 2000;

export async function connectMcp(url: string, signal: AbortSignal): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name: "map-renderer-ai-server", version: "1.0.0" });

  try {
    await client.connect(transport as never, { signal });
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }

  const mcp: McpLike = {
    async listTools(s) {
      const { tools } = await client.listTools(undefined, { signal: s });
      return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    },
    async callTool(name, args, s) {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal: s });
      const blocks = (result.content ?? []) as Array<{ type?: string; text?: string }>;
      const text = blocks.map((b) => (b.type === "text" && b.text ? b.text : "")).join(" ");
      return { text, isError: result.isError === true };
    },
  };

  return {
    mcp,
    async close() {
      // Without terminateSession the server keeps this session until its idle
      // TTL, and a busy ai-server would hit the server's session cap.
      const shutdown = (async () => {
        try { await transport.terminateSession(); } catch { /* best effort */ }
        try { await client.close(); } catch { /* best effort */ }
      })();
      await Promise.race([shutdown, new Promise<void>((r) => setTimeout(r, CLOSE_TIMEOUT_MS).unref())]);
    },
  };
}
