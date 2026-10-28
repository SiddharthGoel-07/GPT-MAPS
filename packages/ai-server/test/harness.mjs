/* eslint-disable */
// Shared helpers for the black-box ai-server tests:
//   fake Groq HTTP server  <--  REAL ai-server (dist/index.js)  -->  REAL MCP server (network stubbed)
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MCP_JS = path.resolve(here, "../../server/dist/index.js");
export const STUB = path.resolve(here, "../../server/test/stub-network.mjs");
export const AI_JS = process.env.AI_SERVER_JS ?? path.resolve(here, "../dist/index.js");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createReporter() {
  const results = [];
  const record = (name, ok, note = "") => {
    results.push({ name, ok, note });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  -- " + note : ""}`);
  };
  const guard = async (name, fn) => {
    try { await fn(); } catch (e) { record(`${name} (EXCEPTION)`, false, String(e.stack ?? e).slice(0, 400)); }
  };
  const finish = () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  };
  return { record, guard, finish, results };
}

async function waitHealthy(port, child, getLog) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  child.kill();
  throw new Error("process did not start: " + getLog());
}
export const stop = (child) => new Promise((r) => { if (child.exitCode !== null) return r(); child.once("exit", r); child.kill(); });

export async function startMcp(port, env = {}) {
  const child = spawn(process.execPath, ["--import", pathToFileURL(STUB).href, MCP_JS], {
    env: { ...process.env, PORT: String(port), NOMINATIM_MIN_INTERVAL_MS: "0", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = ""; child.stderr.on("data", (d) => (log += d));
  await waitHealthy(port, child, () => log);
  return child;
}

export async function startAi(port, mcpPort, groqPort, env = {}) {
  const child = spawn(process.execPath, [AI_JS], {
    env: {
      ...process.env, PORT: String(port), MCP_SERVER_URL: `http://127.0.0.1:${mcpPort}/mcp`,
      GROQ_API_KEY_1: "key-A", GROQ_API_KEY_2: "", GROQ_API_KEY_3: "", GROQ_API_KEY_4: "", GROQ_API_KEY_5: "",
      GROQ_BASE_URL: `http://127.0.0.1:${groqPort}`, ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  await waitHealthy(port, child, () => log);
  return { child, port, getLog: () => log };
}

let callId = 0;
export const completion = (content, calls = []) => ({
  id: "cmpl", object: "chat.completion", created: 0, model: "fake",
  choices: [{
    index: 0, finish_reason: calls.length ? "tool_calls" : "stop",
    message: {
      role: "assistant", content,
      ...(calls.length ? { tool_calls: calls.map(([name, args]) => ({ id: `call_${++callId}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) } : {}),
    },
  }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

/** handler({n, body}) -> {status?, json?, hang?, delayMs?}. `requests` keeps every body the model was sent. */
export async function startGroq(port, handler) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    const info = { n: requests.length, body };
    requests.push(info);
    const out = await handler(info);
    if (out.hang) return;
    if (out.delayMs) await sleep(out.delayMs);
    if (res.destroyed) return;
    res.writeHead(out.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(out.json ?? {}));
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { port, requests, close: () => { for (const s of sockets) s.destroy(); server.close(); } };
}

export const mcpSessions = async (port) => (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).activeSessions;
export const byType = (scene, t) => (scene?.objects ?? []).filter((o) => o.type === t);

/** POST /api/chat; returns {status, json, headers}. */
export async function chat(aiPort, body, { headers = {}, timeoutMs = 20000 } = {}) {
  const r = await fetch(`http://127.0.0.1:${aiPort}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, headers: r.headers, text };
}

/** POST /api/chat asking for the progress stream; returns the parsed lines. */
export async function chatStream(aiPort, body, { headers = {}, timeoutMs = 20000 } = {}) {
  const r = await fetch(`http://127.0.0.1:${aiPort}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson", ...headers },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  const lines = text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { type: "unparsable", l }; } });
  return { status: r.status, contentType: r.headers.get("content-type"), lines, text };
}
