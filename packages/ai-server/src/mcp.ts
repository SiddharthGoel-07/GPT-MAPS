import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { McpLike } from "./chatLoop.js";

export interface McpConnection {
  mcp: McpLike;
  /** Ends the MCP session on the server, then closes the connection. Never throws. */
  close(): Promise<void>;
}

const CLOSE_TIMEOUT_MS = 2000;

export interface ConnectOptions {
  /** Sent as "Authorization: Bearer ..." when the MCP server requires a token. */
  authToken?: string | undefined;
}

export async function connectMcp(
  url: string,
  signal: AbortSignal,
  options: ConnectOptions = {}
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: options.authToken
      ? { headers: { Authorization: `Bearer ${options.authToken}` } }
      : {},
  });
  const client = new Client({ name: "map-renderer-ai-server", version: "1.0.0" });

  try {
    await client.connect(transport, { signal });
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }

  const mcp: McpLike = {
    async listTools(s) {
      // "refresh": always ask the server. A cached answer would hide a lost session.
      const { tools } = await client.listTools(undefined, { signal: s, cacheMode: "refresh" });
      return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    },
    async callTool(name, args, s) {
      const result = await client.callTool({ name, arguments: args }, { signal: s });
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
