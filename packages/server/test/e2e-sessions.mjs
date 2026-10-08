/* eslint-disable */
// End-to-end session isolation tests. Runs the REAL built server (dist/index.js)
// as a child process and talks to it with the real MCP SDK client over HTTP.
// Usage (from repo root, after building shared + server):  node packages/server/test/e2e-sessions.mjs
import { spawn } from "node:child_process";
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

async function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["--import", pathToFileURL(STUB).href, SERVER_JS], {
    env: { ...process.env, PORT: String(port), ...env },
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

async function connect(port) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  await client.connect(transport);
  return { client, transport };
}
const text = (r) => r.content.map((c) => c.text ?? "").join("");
const call = (c, name, args = {}) => c.client.callTool({ name, arguments: args }, undefined, { timeout: 8000 });
async function guard(fn) { try { await fn(); } catch (e) { record("EXCEPTION in test block", false, String(e.message ?? e).slice(0, 160)); } }
async function names(c) {
  const r = await call(c, "renderScene");
  return JSON.parse(text(r)).objects.map((o) => o.metadata.name);
}
const health = async (port) => (await fetch(`http://127.0.0.1:${port}/health`)).json();
const rawPost = (port, body, sid) =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) },
    body: JSON.stringify(body),
  });
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

async function main() {
  const S = await startServer(3911);
  const P = S.port;
  try {
    // T1 sequential
    await guard(async () => {
      const c = await connect(P);
      await call(c, "createMarker", { location: "Delhi" });
      await call(c, "createMarker", { location: "Mumbai" });
      await call(c, "createPath", { start: "Delhi", end: "Mumbai" });
      const n = await names(c);
      record("T1 sequential scene", sameSet(n, ["Delhi", "Mumbai", "Delhi → Mumbai"]), JSON.stringify(n));
      await c.client.close();
    });
    // T2 isolation, 2 clients interleaved
    await guard(async () => {
      const A = await connect(P), B = await connect(P);
      await call(A, "createMarker", { location: "A-Delhi" });
      await call(B, "createMarker", { location: "B-Mumbai" });
      await call(A, "createLabel", { location: "A-Delhi", text: "A label" });
      await call(B, "createPolygon", { location: "B-Kerala" });
      const [na, nb] = [await names(A), await names(B)];
      record("T2 isolation A", sameSet(na, ["A-Delhi", "A-Delhi"]), JSON.stringify(na));
      record("T2 isolation B", sameSet(nb, ["B-Mumbai", "B-Kerala"]), JSON.stringify(nb));
      await A.client.close(); await B.client.close();
    });
    // T2b isolation, 6 concurrent clients, 5 rounds, fully parallel
    await guard(async () => {
      let bad = 0;
      for (let round = 0; round < 5; round++) {
        const cs = await Promise.all([...Array(6)].map(() => connect(P)));
        await Promise.all(cs.map(async (c, i) => {
          for (let k = 0; k < 3; k++) await call(c, "createMarker", { location: `R${round}C${i}M${k}` });
        }));
        const all = await Promise.all(cs.map((c) => names(c)));
        all.forEach((n, i) => { if (!sameSet(n, [0, 1, 2].map((k) => `R${round}C${i}M${k}`))) { bad++; console.log("   leak:", i, JSON.stringify(n)); } });
        await Promise.all(cs.map((c) => c.client.close()));
      }
      record("T2b 6 concurrent clients x5 rounds", bad === 0, `${bad} contaminated scenes`);
    });
    // T3 new connection starts empty
    await guard(async () => {
      const c = await connect(P);
      const n = await names(c);
      record("T3 new connection has empty scene", n.length === 0, JSON.stringify(n));
      await c.client.close();
    });
    // T4 second initialize must not affect a live session
    await guard(async () => {
      const A = await connect(P);
      await call(A, "createMarker", { location: "KeepMe" });
      const B = await connect(P); // new initialize while A is live
      await call(B, "createMarker", { location: "Other" });
      const n = await names(A);
      record("T4 2nd initialize does not disturb live session", sameSet(n, ["KeepMe"]), JSON.stringify(n));
      await A.client.close(); await B.client.close();
    });
    // T5 bad session handling
    await guard(async () => {
      const bogus = await rawPost(P, { jsonrpc: "2.0", id: 1, method: "tools/list" }, "does-not-exist");
      record("T5a bogus session id -> 404", bogus.status === 404, `status ${bogus.status}`);
      const nosid = await rawPost(P, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "renderScene", arguments: {} } });
      record("T5b no session id (non-initialize) -> 400", nosid.status === 400, `status ${nosid.status}`);
      const h = await fetch(`http://127.0.0.1:${P}/health`);
      record("T5c server alive after bad requests", h.status === 200);
    });
    // T6 DELETE terminates session
    await guard(async () => {
      const c = await connect(P);
      const sid = c.transport.sessionId;
      await call(c, "createMarker", { location: "X" });
      const del = await fetch(`http://127.0.0.1:${P}/mcp`, { method: "DELETE", headers: { "mcp-session-id": sid } });
      const after = await rawPost(P, { jsonrpc: "2.0", id: 3, method: "tools/list" }, sid);
      record("T6 DELETE ok then reuse -> 404", del.status === 200 && after.status === 404, `delete ${del.status}, reuse ${after.status}`);
      await c.client.close().catch(() => {});
    });
    // T8 no leak after everything closed (default TTL is long, so rely on DELETE/close hygiene check below via TTL server)
  } finally {
    await stop(S);
  }

  // T7 TTL + cap, on a separate server with tiny limits
  const T = await startServer(3912, { SESSION_TTL_MS: "1500", SESSION_SWEEP_MS: "300", MAX_SESSIONS: "3" });
  try { await guard(async () => {
    const c1 = await connect(T.port);
    const sid = c1.transport.sessionId;
    await sleep(3000);
    const r = await rawPost(T.port, { jsonrpc: "2.0", id: 9, method: "tools/list" }, sid);
    record("T7a idle session evicted by TTL -> 404", r.status === 404, `status ${r.status}`);
    record("T8 active session count returns to 0", (await health(T.port)).activeSessions === 0, JSON.stringify(await health(T.port)));

    const keep = [];
    for (let i = 0; i < 3; i++) keep.push(await connect(T.port));
    let capStatus = "connected (no cap!)";
    try { await connect(T.port); } catch (e) { capStatus = String(e.message ?? e); }
    record("T7b session cap: 4th initialize rejected (503)", /Too many active sessions|503/.test(capStatus), capStatus.slice(0, 120));
    record("T7c active sessions == cap", (await health(T.port)).activeSessions === 3, JSON.stringify(await health(T.port)));
    await Promise.all(keep.map((k) => k.client.close().catch(() => {})));
    await sleep(3000);
    record("T8b all idle sessions cleaned after TTL", (await health(T.port)).activeSessions === 0, JSON.stringify(await health(T.port)));
  }); } finally {
    await stop(T);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
