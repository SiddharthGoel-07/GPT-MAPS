import "dotenv/config";
import { createServer as createHttpServer } from "node:http";
import { runChat, validatePrompt } from "./chatLoop.js";
import type { ChatResult } from "./chatLoop.js";
import { readLimits } from "./config.js";
import { ChatError, deadlineError } from "./errors.js";
import { createGroqLlm } from "./groq.js";
import { KeyPool } from "./keyPool.js";
import { connectMcp } from "./mcp.js";
import { SYSTEM_PROMPT } from "./prompt.js";

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

console.log(
  `[AI] Limits: prompt<=${limits.maxPromptChars} chars, ` +
    `<=${limits.maxToolIterations} LLM turns, timeout ${limits.requestTimeoutMs}ms`
);

const pool = new KeyPool({ keys: groqApiKeys, log: (message) => console.log(message) });
const llm = createGroqLlm({ pool, model: MODEL, baseURL: process.env.GROQ_BASE_URL });

async function handleChat(prompt: unknown): Promise<ChatResult> {
  // Reject bad prompts before spending an MCP session or an LLM call.
  const validPrompt = validatePrompt(prompt, limits);

  const controller = new AbortController();
  const deadlineAt = Date.now() + limits.requestTimeoutMs;
  const timer = setTimeout(() => controller.abort(deadlineError()), limits.requestTimeoutMs);
  let connection: Awaited<ReturnType<typeof connectMcp>> | undefined;

  try {
    connection = await connectMcp(MCP_SERVER_URL as string, controller.signal);

    return await runChat({
      prompt: validPrompt,
      systemPrompt: SYSTEM_PROMPT,
      llm,
      mcp: connection.mcp,
      limits,
      context: { signal: controller.signal, deadlineAt },
      log: (message) => console.log(message),
    });
  } catch (error) {
    // SDKs report an abort as a generic AbortError; the real cause is the deadline.
    if (controller.signal.aborted) throw deadlineError();
    throw error;
  } finally {
    clearTimeout(timer);
    await connection?.close();
  }
}

interface ChatRequest {
  prompt?: unknown;
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const httpServer = createHttpServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);

      let body: ChatRequest;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as ChatRequest;
      } catch {
        throw new ChatError(400, "Request body must be valid JSON.");
      }

      sendJson(res, 200, await handleChat(body.prompt));
    } catch (error) {
      if (error instanceof ChatError) {
        console.error(`Chat error (${error.status}): ${error.message}`, error.cause ?? "");
        sendJson(res, error.status, { error: error.message });
      } else {
        console.error("Chat error:", error);
        sendJson(res, 500, { error: "Failed to process request" });
      }
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

const port = Number(process.env.PORT) || 3002;
const host = "0.0.0.0";

httpServer.listen(port, host, () => {
  console.error(`AI Server listening on http://${host}:${port}`);
});
