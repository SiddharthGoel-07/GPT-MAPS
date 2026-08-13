import { createServer as createHttpServer } from "node:http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  const httpServer = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found. Use /mcp" }));
        return;
      }

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          if (Array.isArray(value)) {
            for (const v of value) {
              headers.append(key, v);
            }
          } else {
            headers.set(key, value);
          }
        }
      }

      const body = req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
        ? await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", () => resolve(Buffer.concat(chunks)));
            req.on("error", reject);
          })
        : undefined;

      const init: RequestInit = {
        method: req.method as string,
        headers,
      };

      if (body && body.length > 0) {
        init.body = new Uint8Array(body);
      }

      const request = new Request(url, init);

      const response = await transport.handleRequest(request);

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      }

      res.end();
    } catch (error) {
      console.error("MCP request error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  const port = Number(process.env.PORT) || 3001;
  const host = "0.0.0.0";

  httpServer.listen(port, host, () => {
    console.error(`Map Renderer MCP Server listening on http://${host}:${port}/mcp`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});