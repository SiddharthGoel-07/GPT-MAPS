import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  WebStandardStreamableHTTPServerTransport,
  isInitializeRequest,
} from "@modelcontextprotocol/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { createServer } from "./server.js";

/*
 * Session model: one MCP session = one McpServer = one Scene.
 * A session is created by an `initialize` request, routed by the
 * `Mcp-Session-Id` header, and removed by DELETE, transport close,
 * or an idle TTL sweep (clients such as ai-server may just disconnect).
 */

interface Session {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  lastActivity: number;
  inflight: number;
}

const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const SESSION_TTL_MS = envInt("SESSION_TTL_MS", 10 * 60_000);
const SESSION_SWEEP_MS = envInt("SESSION_SWEEP_MS", 30_000);
const MAX_SESSIONS = envInt("MAX_SESSIONS", 100);

const sessions = new Map<string, Session>();
let pendingInits = 0;

async function closeSession(id: string, reason: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id); // delete first: later requests get 404 immediately
  try {
    await session.server.close(); // also closes the transport
  } catch {
    /* already closed */
  }
  console.error(`[session] closed ${id} (${reason}); active=${sessions.size}`);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.inflight === 0 && now - s.lastActivity > SESSION_TTL_MS) {
      void closeSession(id, "idle ttl");
    }
  }
}, SESSION_SWEEP_MS).unref();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function toWebRequest(req: IncomingMessage, url: URL, body: Buffer | undefined): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  const init: RequestInit = { method: req.method as string, headers };
  if (body && body.length > 0) init.body = new Uint8Array(body);
  return new Request(url, init);
}

async function pipeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    const reader = response.body.getReader();
    // Stop reading if the client goes away (matters for long-lived SSE GETs).
    res.on("close", () => void reader.cancel().catch(() => undefined));
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch {
      /* stream cancelled because the client disconnected */
    }
  }
  res.end();
}

async function createSession(): Promise<Session> {
  const server = createServer(); // fresh Scene for this session
  const session: Session = {
    server,
    lastActivity: Date.now(),
    inflight: 0,
    transport: undefined as unknown as WebStandardStreamableHTTPServerTransport,
  };
  session.transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id) => {
      sessions.set(id, session);
      console.error(`[session] opened ${id}; active=${sessions.size}`);
    },
    onsessionclosed: (id) => {
      void closeSession(id, "client DELETE");
    },
  });
  await server.connect(session.transport);
  return session;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const body = req.method === "POST" ? await readBody(req) : undefined;
  const header = req.headers["mcp-session-id"];
  const sessionId = Array.isArray(header) ? header[0] : header;

  let session: Session | undefined;
  let isNew = false;

  if (sessionId) {
    session = sessions.get(sessionId);
    if (!session) return rpcError(res, 404, -32001, "Session not found");
  } else {
    // No session id: the only valid request is a POST carrying `initialize`.
    let parsed: unknown;
    try {
      parsed = body && body.length > 0 ? JSON.parse(body.toString("utf-8")) : undefined;
    } catch {
      return rpcError(res, 400, -32700, "Parse error: Invalid JSON");
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    if (req.method !== "POST" || !messages.some((m) => isInitializeRequest(m))) {
      return rpcError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
    }
    if (sessions.size + pendingInits >= MAX_SESSIONS) {
      res.setHeader("Retry-After", "30");
      return rpcError(res, 503, -32000, "Too many active sessions");
    }
    pendingInits++;
    try {
      session = await createSession();
      isNew = true;
    } finally {
      pendingInits--;
    }
  }

  // Long-lived GET (SSE) streams must not count as "busy", otherwise a client
  // that stays connected but never calls anything would pin its session forever.
  const countsAsBusy = req.method !== "GET";
  if (countsAsBusy) session.inflight++;
  session.lastActivity = Date.now();
  try {
    const response = await session.transport.handleRequest(toWebRequest(req, url, body));
    await pipeResponse(res, response);
  } finally {
    if (countsAsBusy) session.inflight--;
    session.lastActivity = Date.now();
    // initialize rejected by the transport => it never registered; release it.
    if (isNew && !session.transport.sessionId) void session.server.close().catch(() => undefined);
  }
}

const httpServer = createHttpServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health" || url.pathname === "/") {
      return sendJson(res, 200, { status: "ok", activeSessions: sessions.size });
    }
    if (url.pathname !== "/mcp") {
      return sendJson(res, 404, { error: "Not found. Use /mcp" });
    }
    await handleMcp(req, res, url);
  } catch (error) {
    console.error("MCP request error:", error);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal server error" });
    else res.end();
  }
});

const port = Number(process.env.PORT) || 3001;
const host = "0.0.0.0";

httpServer.listen(port, host, () => {
  console.error(`Map Renderer MCP Server listening on http://${host}:${port}/mcp`);
});
