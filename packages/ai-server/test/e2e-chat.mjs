/* eslint-disable */
// Black-box test of the ai-server tool loop.
//   fake Groq HTTP server  <--  REAL ai-server (dist/index.js)  -->  REAL MCP server (network stubbed)
// Works against both the old and the new ai-server, so the same file gives the baseline.
// Usage (repo root, after building shared, server, ai-server):  node packages/ai-server/test/e2e-chat.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MCP_JS = path.resolve(here, "../../server/dist/index.js");
const STUB = path.resolve(here, "../../server/test/stub-network.mjs");
const AI_JS = process.env.AI_SERVER_JS ?? path.resolve(here, "../dist/index.js");
const MCP_PORT = 3941;
let nextPort = 3951;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  -- " + note : ""}`);
};
async function guard(name, fn) {
  try { await fn(); } catch (e) { record(`${name} (EXCEPTION)`, false, String(e.stack ?? e).slice(0, 300)); }
}

/* ------------------------------ processes ------------------------------ */

async function waitHealthy(port, child, getLog) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  child.kill();
  throw new Error("process did not start: " + getLog());
}
const stop = (child) => new Promise((r) => { if (child.exitCode !== null) return r(); child.once("exit", r); child.kill(); });

async function startMcp() {
  const child = spawn(process.execPath, ["--import", pathToFileURL(STUB).href, MCP_JS], {
    env: { ...process.env, PORT: String(MCP_PORT), NOMINATIM_MIN_INTERVAL_MS: "0" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = ""; child.stderr.on("data", (d) => (log += d));
  await waitHealthy(MCP_PORT, child, () => log);
  return child;
}

async function startAi(groqPort, env = {}) {
  const port = nextPort++;
  const child = spawn(process.execPath, [AI_JS], {
    env: {
      ...process.env, PORT: String(port), MCP_SERVER_URL: `http://127.0.0.1:${MCP_PORT}/mcp`,
      GROQ_API_KEY_1: "key-A", GROQ_API_KEY_2: "key-B", GROQ_API_KEY_3: "", GROQ_API_KEY_4: "", GROQ_API_KEY_5: "",
      GROQ_BASE_URL: `http://127.0.0.1:${groqPort}`, ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  await waitHealthy(port, child, () => log);
  return { child, port, getLog: () => log };
}

/* ------------------------------- fake Groq ------------------------------- */

let callId = 0;
const completion = (content, calls = []) => ({
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

/** handler({key, n, byKey, body}) -> {status?, headers?, json?, hang?} ; n = 0-based index of this request overall */
async function startGroq(handler) {
  const port = nextPort++;
  const requests = [];
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    const key = (req.headers.authorization ?? "").replace("Bearer ", "");
    const info = { key, n: requests.length, body };
    requests.push(info);
    info.byKey = requests.filter((r) => r.key === key).length - 1;
    const out = await handler(info);
    if (out.hang) return; // never answer
    res.writeHead(out.status ?? 200, { "content-type": "application/json", ...(out.headers ?? {}) });
    res.end(JSON.stringify(out.json ?? {}));
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return {
    port, requests,
    count: (key) => requests.filter((r) => r.key === key).length,
    close: () => { for (const s of sockets) s.destroy(); server.close(); },
  };
}

const err = (status, message, headers = {}) => ({ status, headers, json: { error: { message, type: "x" } } });

/** One scenario = fresh fake Groq + fresh ai-server; always cleaned up. */
async function scenario(handler, env, fn) {
  const groq = await startGroq(handler);
  let ai;
  try {
    ai = await startAi(groq.port, env);
    await fn({
      groq, ai,
      chat: async (prompt, timeoutMs = 20000) => {
        const t0 = Date.now();
        try {
          const r = await fetch(`http://127.0.0.1:${ai.port}/api/chat`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt }), signal: AbortSignal.timeout(timeoutMs),
          });
          const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
          return { status: r.status, json, ms: Date.now() - t0 };
        } catch (e) { return { status: 0, json: null, ms: Date.now() - t0, error: String(e.name) }; }
      },
    });
  } finally { if (ai) await stop(ai.child); groq.close(); }
}
const mcpSessions = async () => (await (await fetch(`http://127.0.0.1:${MCP_PORT}/health`)).json()).activeSessions;
const byType = (scene, t) => (scene?.objects ?? []).filter((o) => o.type === t);

/* -------------------------------- tests -------------------------------- */

async function main() {
  const mcp = await startMcp();
  try {
    await guard("X1", () => scenario(
      ({ n }) => ({ json: completion(null, [["createMarker", { location: "Delhi" }], ["renderScene", {}], ["createLabel", { location: "Delhi", text: "Capital" }]]) }),
      {}, async ({ chat }) => {
        const r = await chat("mark Delhi and label it Capital");
        const labels = byType(r.json?.scene, "label");
        record("X1 tool calls AFTER renderScene in the same turn still run", r.status === 200 && labels.length === 1 && labels[0].text === "Capital",
          `status=${r.status} labels=${JSON.stringify(labels.map((l) => l.text))}`);
      }));

    await guard("X2", () => scenario(
      ({ n }) => ({ json: n === 0 ? completion(null, [["createMarker", { location: "Delhi" }]]) : completion("Here is Delhi on the map.") }),
      {}, async ({ chat }) => {
        const r = await chat("show Delhi");
        record("X2 model never calls renderScene: scene still rendered, model text returned (passes on old code too)",
          r.status === 200 && byType(r.json?.scene, "marker").length === 1 && r.json?.message === "Here is Delhi on the map.", `message=${JSON.stringify(r.json?.message)}`);
      }));

    await guard("X2b", () => scenario(
      () => ({ json: completion("Marking Delhi now.", [["createMarker", { location: "Delhi" }], ["renderScene", {}]]) }),
      {}, async ({ chat }) => {
        const r = await chat("show Delhi");
        record("X2b model text in the renderScene turn is kept as the reply", r.status === 200 && r.json?.message === "Marking Delhi now.", `message=${JSON.stringify(r.json?.message)}`);
      }));

    await guard("X3", () => scenario(
      () => ({ json: completion(null, [["createMarker", { location: "Delhi" }], ["createMarker", { location: "Mumbai" }], ["createPath", { start: "Delhi", end: "Mumbai" }], ["renderScene", {}]]) }),
      {}, async ({ chat }) => {
        const r = await chat("route");
        const m = r.json?.message ?? "";
        record("X3 no model text -> reply summarises what was drawn (not the constant 'Scene rendered.')", r.status === 200 && /2 markers/.test(m) && /1 path/.test(m), `message=${JSON.stringify(m)}`);
      }));

    await guard("X4", () => scenario(
      ({ key, n }) => key === "key-A" ? err(429, "Rate limit reached. Please try again in 5ms", { "retry-after-ms": "5" })
        : { json: n < 5 ? completion(null, [["createMarker", { location: "Delhi" }]]) : completion("done") },
      {}, async ({ chat, groq }) => {
        const r = await chat("show Delhi");
        const a = groq.count("key-A"), b = groq.count("key-B");
        record("X4 a rate-limited key is not retried in a loop: next key is used (key A tried at most once per LLM turn)", r.status === 200 && b >= 1 && a <= b,
          `status=${r.status} keyA=${a} keyB=${b}`);
      }));

    await guard("X4b", () => scenario(
      ({ key, n }) => key === "key-A" ? err(429, "Rate limit reached. Please try again in 3s", { "retry-after-ms": "3000" })
        : { json: n < 5 ? completion(null, [["createMarker", { location: "Delhi" }]]) : completion("done") },
      {}, async ({ chat, groq }) => {
        const r = await chat("show Delhi", 30000);
        record("X4b Retry-After is honoured: key A gets exactly 1 request, the rest go to key B, and the reply is fast", r.status === 200 && groq.count("key-A") === 1 && r.ms < 3000,
          `status=${r.status} keyA=${groq.count("key-A")} keyB=${groq.count("key-B")} ms=${r.ms}`);
      }));

    await guard("X5", () => scenario(
      ({ key }) => key === "key-A" ? err(400, "bad request") : { json: completion("ok") },
      {}, async ({ chat, groq }) => {
        const r = await chat("show Delhi");
        record("X5 HTTP 400 is not retried on other keys (fails fast)", r.status !== 200 && groq.count("key-B") === 0, `status=${r.status} keyA=${groq.count("key-A")} keyB=${groq.count("key-B")}`);
      }));

    await guard("X6", () => scenario(
      ({ n }) => n === 0 ? err(500, "boom") : { json: completion("fine") },
      { GROQ_API_KEY_2: "" }, async ({ chat, groq }) => {
        const r = await chat("hi");
        record("X6 transient 500 is retried and succeeds (passes on old code too: SDK retries)", r.status === 200 && groq.requests.length === 2, `status=${r.status} reqs=${groq.requests.length}`);
      }));

    await guard("X7", () => scenario(
      ({ n }) => n < 3 ? err(429, "Rate limit reached. Please try again in 300ms", { "retry-after-ms": "300" }) : { json: completion("recovered") },
      {}, async ({ chat }) => {
        const r = await chat("hi");
        record("X7 all keys rate limited briefly -> waits and recovers (passes on old code too)", r.status === 200 && r.json?.message === "recovered", `status=${r.status}`);
      }));

    await guard("X8", () => scenario(
      () => ({ json: completion("ok") }),
      { MAX_PROMPT_CHARS: "200" }, async ({ chat, groq }) => {
        const r = await chat("x".repeat(300));
        record("X8 over-long prompt rejected with 400 before any LLM call", r.status === 400 && groq.requests.length === 0, `status=${r.status} llm calls=${groq.requests.length}`);
      }));

    await guard("X9", () => {
      let i = 0;
      return scenario(
        () => ({ json: completion(null, [["createMarker", { location: `Place${++i}` }]]) }),
        { MAX_TOOL_ITERATIONS: "3" }, async ({ chat, groq }) => {
          const r = await chat("never stops");
          record("X9 iteration cap: <=3 LLM calls, partial scene still returned with a notice", r.status === 200 && groq.requests.length <= 3 && byType(r.json?.scene, "marker").length === groq.requests.length && /incomplete|stopped/i.test(r.json?.message ?? ""),
            `status=${r.status} llm calls=${groq.requests.length} markers=${byType(r.json?.scene, "marker").length} message=${JSON.stringify(r.json?.message)}`);
        });
    });

    await guard("X10", () => scenario(
      () => ({ hang: true }),
      { REQUEST_TIMEOUT_MS: "1500" }, async ({ chat }) => {
        const r = await chat("hang", 6000);
        record("X10 overall deadline: hung LLM -> 504 within ~2s", r.status === 504 && r.ms < 4000, `status=${r.status} ms=${r.ms} ${r.error ?? ""}`);
      }));

    await guard("X11", () => scenario(
      ({ n }) => ({ json: n === 0 ? completion(null, [["createMarker", { location: "Delhi" }]]) : completion("ok") }),
      {}, async ({ chat }) => {
        const before = await mcpSessions();
        const r = await chat("show Delhi");
        await sleep(300);
        const after = await mcpSessions();
        record("X11 MCP session is closed after each chat (no leaked sessions)", r.status === 200 && after === before, `before=${before} after=${after}`);
      }));

    await guard("X12", () => scenario(
      ({ n }) => ({ json: n === 0 ? completion(null, [["createMarker", {}], ["createMarker", { location: "Delhi" }]]) : completion("handled") }),
      {}, async ({ chat }) => {
        const r = await chat("bad args first");
        record("X12 a failing tool call does not abort the chat (passes on old code too)", r.status === 200 && byType(r.json?.scene, "marker").length === 1, `status=${r.status}`);
      }));
  } finally { await stop(mcp); }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
