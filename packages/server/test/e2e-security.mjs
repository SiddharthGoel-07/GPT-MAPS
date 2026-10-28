/* eslint-disable */
// D1 for the MCP server: where it listens, which browser origins are refused, optional bearer token,
// request body size limit. Real built server as a child process.
// Usage (repo root, after building shared + server):  node packages/server/test/e2e-security.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.resolve(here, "../dist/index.js");
const STUB = path.resolve(here, "stub-network.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  -- " + note : ""}`);
};
async function guard(name, fn) {
  try { await fn(); } catch (e) { record(`${name} (EXCEPTION)`, false, String(e.stack ?? e).slice(0, 300)); }
}

async function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["--import", pathToFileURL(STUB).href, SERVER_JS], {
    env: { ...process.env, PORT: String(port), NOMINATIM_MIN_INTERVAL_MS: "0", ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return { child, getLog: () => log, port }; } catch {}
    await sleep(100);
  }
  child.kill();
  throw new Error("server did not start: " + log);
}
const stop = (s) => new Promise((r) => { s.child.once("exit", r); s.child.kill(); });

const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sec", version: "1" } },
};
const post = (port, body, headers = {}) => fetch(`http://127.0.0.1:${port}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

/** First non-loopback IPv4 address of this machine, if any. */
const externalIp = () => {
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) return i.address;
  return null;
};
const canConnect = (host, port) => new Promise((resolve) => {
  const req = http.get({ host, port, path: "/health", timeout: 1500 }, (res) => { res.resume(); resolve(true); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

async function main() {
  const ext = externalIp();

  /* ----------------------------- listening address ---------------------------- */
  const D = await startServer(3981);
  const W = await startServer(3982, { HOST: "0.0.0.0" });
  try {
    await guard("H", async () => {
      record("H1 default: reachable on 127.0.0.1", await canConnect("127.0.0.1", D.port));
      if (ext) {
        record("H2 default: NOT reachable through the machine's network address (not exposed)", !(await canConnect(ext, D.port)), `ext=${ext}`);
        record("H3 HOST=0.0.0.0 still works when the owner asks for it (proves H2 is real)", await canConnect(ext, W.port), `ext=${ext}`);
      } else {
        console.log("SKIP  H2/H3 no non-loopback network interface in this environment (check by hand)");
      }
    });

    /* ------------------------------ origin + body ------------------------------- */
    await guard("O", async () => {
      let r = await post(D.port, INIT);
      record("O1 a client without Origin (like ai-server) works", r.status === 200, `status=${r.status}`);
      r = await post(D.port, INIT, { origin: "http://evil.example" });
      const body = await r.json().catch(() => ({}));
      record("O2 a browser Origin that is not listed is refused with 403", r.status === 403 && /ALLOWED_ORIGINS/.test(body.error ?? ""), `status=${r.status} ${JSON.stringify(body)}`);
      r = await fetch(`http://127.0.0.1:${D.port}/health`, { headers: { origin: "http://evil.example" } });
      record("O3 /health stays open (monitoring)", r.status === 200);

      const big = JSON.stringify({ ...INIT, padding: "x".repeat(2 * 1024 * 1024) });
      r = await post(D.port, big);
      record("O4 a body over the default limit (1 MB) -> 413", r.status === 413, `status=${r.status}`);
      r = await post(D.port, INIT);
      record("O5 the server is still healthy after rejecting an oversized body", r.status === 200);
    });
  } finally { await stop(D); await stop(W); }

  const A = await startServer(3983, { ALLOWED_ORIGINS: "http://ok.example", MAX_BODY_BYTES: "1500" });
  try {
    await guard("A", async () => {
      let r = await post(A.port, INIT, { origin: "http://ok.example" });
      record("A1 a listed Origin is accepted", r.status === 200, `status=${r.status}`);
      r = await post(A.port, INIT, { origin: "http://ok.example.evil.test" });
      record("A2 a look-alike origin is refused (exact match only)", r.status === 403);
      r = await post(A.port, JSON.stringify({ ...INIT, padding: "x".repeat(3000) }));
      record("A3 MAX_BODY_BYTES is honoured (3 KB body vs 1.5 KB limit) -> 413", r.status === 413, `status=${r.status}`);

      // Body without Content-Length (chunked) that grows past the limit.
      const status = await new Promise((resolve) => {
        const req = http.request({ host: "127.0.0.1", port: A.port, path: "/mcp", method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "transfer-encoding": "chunked" } },
          (res) => { res.resume(); resolve(res.statusCode); });
        req.on("error", () => resolve("closed"));
        req.write("{\"a\":\"" + "y".repeat(1000));
        setTimeout(() => { req.write("y".repeat(2000)); req.end("\"}"); }, 50);
        setTimeout(() => resolve("timeout"), 4000);
      });
      record("A4 a chunked body with no Content-Length is cut off too (413 or connection closed)", status === 413 || status === "closed", `result=${status}`);
      r = await post(A.port, INIT);
      record("A5 still serving afterwards", r.status === 200);
    });
  } finally { await stop(A); }

  /* --------------------------------- token ----------------------------------- */
  const T = await startServer(3984, { MCP_AUTH_TOKEN: "s3cret-token" });
  try {
    await guard("T", async () => {
      let r = await post(T.port, INIT);
      record("T1 token set: no Authorization -> 401", r.status === 401, `status=${r.status}`);
      r = await post(T.port, INIT, { authorization: "Bearer wrong" });
      record("T2 token set: wrong token -> 401", r.status === 401);
      r = await post(T.port, INIT, { authorization: "Bearer s3cret-token" });
      record("T3 token set: right token -> 200", r.status === 200);
      r = await fetch(`http://127.0.0.1:${T.port}/health`);
      record("T4 /health needs no token", r.status === 200);

      const withToken = new Client({ name: "tok", version: "1" });
      await withToken.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${T.port}/mcp`), {
        requestInit: { headers: { Authorization: "Bearer s3cret-token" } },
      }));
      const tools = (await withToken.listTools()).tools.length;
      const res = await withToken.callTool({ name: "clearScene", arguments: {} });
      record("T5 a real MCP client with the token can list and call tools for a whole session", tools >= 5 && !res.isError, `tools=${tools}`);
      await withToken.close();

      const without = new Client({ name: "notok", version: "1" });
      const failed = await without.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${T.port}/mcp`))).then(() => false, () => true);
      record("T6 a real MCP client without the token cannot connect", failed);
      await without.close().catch(() => undefined);
    });
  } finally { await stop(T); }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
