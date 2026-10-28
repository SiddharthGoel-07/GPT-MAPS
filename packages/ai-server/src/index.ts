import "dotenv/config";
import { createServer as createHttpServer } from "node:http";
import { runChat, validatePrompt } from "./chatLoop.js";
import type { ChatResult, McpLike } from "./chatLoop.js";
import { readConversationConfig, readLimits, readServerConfig } from "./config.js";
import { ConversationStore } from "./conversations.js";
import { ChatError, deadlineError } from "./errors.js";
import { createGroqLlm } from "./groq.js";
import { KeyPool } from "./keyPool.js";
import { describeMap } from "./mapContext.js";
import { connectMcp } from "./mcp.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { RateLimiter, applyCors, checkToken, readBodyLimited } from "./security.js";

/*
 * GROQ API KEYS (in .env): GROQ_API_KEY_1 ... GROQ_API_KEY_5
 * Failure handling (which errors rotate keys, which are retried, which fail
 * fast) lives in keyPool.ts.
 */

const groqApiKeys = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
].filter((key): key is string => Boolean(key));

if (groqApiKeys.length === 0) {
  console.error("No Groq API keys configured.");
  process.exit(1);
}

console.log(`[AI] Loaded ${groqApiKeys.length} Groq API key(s).`);

const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
if (!MCP_SERVER_URL) {
  throw new Error("MCP_SERVER_URL environment variable is required.");
}

const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const limits = readLimits();
const serverConfig = readServerConfig();
const conversationConfig = readConversationConfig();

console.log(
  `[AI] Limits: prompt<=${limits.maxPromptChars} chars, ` +
    `<=${limits.maxToolIterations} LLM turns, timeout ${limits.requestTimeoutMs}ms`
);

const pool = new KeyPool({ keys: groqApiKeys, log: (message) => console.log(message) });
const llm = createGroqLlm({ pool, model: MODEL, baseURL: process.env.GROQ_BASE_URL });

const store = new ConversationStore({
  connect: (signal) => connectMcp(MCP_SERVER_URL as string, signal, { authToken: serverConfig.mcpAuthToken }),
  ttlMs: conversationConfig.ttlMs,
  maxConversations: conversationConfig.maxConversations,
  log: (message) => console.log(message),
});
store.start(conversationConfig.sweepMs);

const rateLimiter = new RateLimiter(serverConfig.rateLimitPerMinute);
setInterval(() => rateLimiter.sweep(), 60_000).unref();

interface ChatBody {
  prompt?: unknown;
  conversationId?: unknown;
}

interface ChatResponse extends ChatResult {
  /** Present when the request named a conversation. */
  conversationId?: string;
  /** Present with conversationId: false when an existing map was continued. */
  isNewConversation?: boolean;
}

/** What is on the map right now, as text for the model. "" if empty or unreadable. */
async function currentMapSummary(mcp: McpLike, signal: AbortSignal): Promise<string> {
  try {
    const rendered = await mcp.callTool("renderScene", {}, signal);
    if (rendered.isError) return "";
    const parsed = JSON.parse(rendered.text) as { objects?: unknown };
    return Array.isArray(parsed.objects) ? describeMap(parsed.objects as Array<Record<string, unknown>>) : "";
  } catch {
    if (signal.aborted) throw deadlineError();
    return "";
  }
}

async function handleChat(
  body: ChatBody,
  controller: AbortController,
  onProgress: (text: string) => void
): Promise<ChatResponse> {
  // Reject bad input before spending an MCP session or an LLM call.
  const validPrompt = validatePrompt(body.prompt, limits);
  const conversationId = body.conversationId;
  if (conversationId !== undefined && typeof conversationId !== "string") {
    throw new ChatError(400, "conversationId must be a string.");
  }

  const deadlineAt = Date.now() + limits.requestTimeoutMs;
  const timer = setTimeout(() => controller.abort(deadlineError()), limits.requestTimeoutMs);
  let lease: Awaited<ReturnType<ConversationStore["acquire"]>> | undefined;

  try {
    try {
      lease = await store.acquire(conversationId, controller.signal);
    } catch (error) {
      if (error instanceof ChatError || controller.signal.aborted) throw error;
      // Connecting to the MCP server failed (down, wrong URL, wrong token).
      throw new ChatError(
        502,
        "The map server could not be reached. Check that it is running and that MCP_SERVER_URL and MCP_AUTH_TOKEN are correct.",
        { cause: error }
      );
    }

    const mapSummary = lease.resumed ? await currentMapSummary(lease.mcp, controller.signal) : "";

    const result = await runChat({
      prompt: validPrompt,
      history: lease.history,
      mapSummary,
      onProgress,
      systemPrompt: SYSTEM_PROMPT,
      llm,
      mcp: lease.mcp,
      limits,
      context: { signal: controller.signal, deadlineAt },
      log: (message) => console.log(message),
    });

    lease.commit(validPrompt, result.message);
    return lease.id === undefined
      ? result
      : { ...result, conversationId: lease.id, isNewConversation: !lease.resumed };
  } catch (error) {
    // SDKs report an abort as a generic AbortError; the real cause is the deadline.
    if (controller.signal.aborted) throw deadlineError();
    throw error;
  } finally {
    clearTimeout(timer);
    await lease?.release();
  }
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res: import("node:http").ServerResponse, error: unknown): void {
  if (error instanceof ChatError) {
    console.error(`Chat error (${error.status}): ${error.message}`, error.cause ?? "");
    sendJson(res, error.status, { error: error.message });
  } else {
    console.error("Chat error:", error);
    sendJson(res, 500, { error: "Failed to process request" });
  }
}

const wantsStream = (req: import("node:http").IncomingMessage): boolean =>
  (req.headers.accept ?? "").includes("application/x-ndjson");

const httpServer = createHttpServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    const originProblem = applyCors(req, res, serverConfig);
    if (originProblem) return sendError(res, originProblem);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { status: "ok", activeConversations: store.size });
      return;
    }

    const isApi = path === "/api/chat" || path.startsWith("/api/conversations/");
    if (!isApi) return sendJson(res, 404, { error: "Not found" });

    const tokenProblem = checkToken(req, serverConfig);
    if (tokenProblem) return sendError(res, tokenProblem);

    if (req.method === "DELETE" && path.startsWith("/api/conversations/")) {
      // "New map": ends the conversation and its MCP session. Idempotent.
      const id = decodeURIComponent(path.slice("/api/conversations/".length));
      await store.remove(id);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && path === "/api/chat") {
      const waitSeconds = rateLimiter.check(req.socket.remoteAddress ?? "unknown");
      if (waitSeconds !== null) {
        res.setHeader("Retry-After", String(waitSeconds));
        throw new ChatError(429, `Too many requests. Please wait ${waitSeconds} seconds and try again.`);
      }

      const raw = await readBodyLimited(req, serverConfig.maxBodyBytes);
      let body: ChatBody;
      try {
        const parsed: unknown = JSON.parse(raw.toString("utf-8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
        body = parsed as ChatBody;
      } catch {
        throw new ChatError(400, "Request body must be a JSON object.");
      }

      const controller = new AbortController();
      // Stop paying for LLM calls if the browser went away.
      res.on("close", () => {
        if (!res.writableEnded && !controller.signal.aborted) controller.abort(new Error("client went away"));
      });

      if (!wantsStream(req)) {
        sendJson(res, 200, await handleChat(body, controller, () => undefined));
        return;
      }

      // Streaming: one JSON object per line. Headers are sent with the first
      // line, so errors that happen before that are still normal HTTP errors.
      let started = false;
      const send = (event: unknown): void => {
        if (res.writableEnded || res.destroyed) return;
        if (!started) {
          started = true;
          res.writeHead(200, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
          });
        }
        res.write(`${JSON.stringify(event)}\n`);
      };

      try {
        const result = await handleChat(body, controller, (text) => send({ type: "progress", text }));
        send({ type: "result", ...result });
        res.end();
      } catch (error) {
        if (!started) throw error;
        const status = error instanceof ChatError ? error.status : 500;
        const message = error instanceof ChatError ? error.message : "Failed to process request";
        console.error(`Chat error (${status}): ${message}`, error instanceof ChatError ? (error.cause ?? "") : error);
        send({ type: "error", status, error: message });
        res.end();
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof ChatError && error.status === 413 && !res.headersSent) {
      // Answer, then drop the connection so the rest of the oversized upload is not read.
      res.setHeader("Connection", "close");
      res.once("finish", () => req.destroy());
    }
    if (!res.headersSent) sendError(res, error);
    else res.end();
  }
});

const port = Number(process.env.PORT) || 3002;
const host = serverConfig.host;

httpServer.listen(port, host, () => {
  console.error(`AI Server listening on http://${host}:${port}`);
  console.error(`[security] allowed origins: ${serverConfig.allowedOrigins.join(", ")}`);
  if (serverConfig.authToken === undefined && host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    console.error("[security] WARNING: listening beyond this machine without AUTH_TOKEN.");
  }
});

async function shutdown(): Promise<void> {
  // Give open MCP sessions a chance to end cleanly, but never hang.
  await Promise.race([store.closeAll(), new Promise<void>((r) => setTimeout(r, 3000).unref())]);
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
