/* eslint-disable */
// D1 for the ai-server, black-box: bind address, CORS allowlist, bearer token, rate limit, body size cap,
// and the token the ai-server presents to the MCP server.
// Usage (repo root, after building all three server packages):  node packages/ai-server/test/e2e-security.mjs
// Ports: MCP 4101 (open) / 4102 (needs token); ai-server 4111+; fake Groq 4121+.
import http from "node:http";
import os from "node:os";
import { chat, completion, createReporter, sleep, startAi, startGroq, startMcp, stop } from "./harness.mjs";

const { record, guard, finish } = createReporter();
let nextAi = 4111, nextGroq = 4121;
const OPEN = 4101, TOKEN_MCP = 4102;
const model = () => ({ json: completion("Nothing to draw.") });
const ext = (() => { for (const l of Object.values(os.networkInterfaces())) for (const i of l ?? []) if (i.family === "IPv4" && !i.internal) return i.address; return null; })();
const canConnect = (host, port) => new Promise((resolve) => {
  const req = http.get({ host, port, path: "/health", timeout: 1500 }, (res) => { res.resume(); resolve(true); });
  req.on("error", () => resolve(false)); req.on("timeout", () => { req.destroy(); resolve(false); });
});

async function withAi(env, fn, { mcp = OPEN } = {}) {
  const groq = await startGroq(nextGroq++, model);
  let ai;
  try { ai = await startAi(nextAi++, mcp, groq.port, env); await fn(ai); }
  finally { if (ai) await stop(ai.child); groq.close(); }
}
const url = (ai, p) => `http://127.0.0.1:${ai.port}${p}`;
const send = (ai, { method = "POST", path = "/api/chat", headers = {}, body } = {}) =>
  fetch(url(ai, path), { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });

async function main() {
  const mcp = await startMcp(OPEN);
  const mcpTok = await startMcp(TOKEN_MCP, { MCP_AUTH_TOKEN: "mcp-secret" });
  try {
    await guard("H", async () => {
      await withAi({}, async (ai) => {
        record("H1 default: reachable on 127.0.0.1", await canConnect("127.0.0.1", ai.port));
        if (ext) record("H2 default: NOT reachable through the machine's network address", !(await canConnect(ext, ai.port)), `ext=${ext}`);
        else console.log("SKIP  H2 no non-loopback interface here (check by hand)");
      });
      if (ext) await withAi({ HOST: "0.0.0.0" }, async (ai) => {
        record("H3 HOST=0.0.0.0 exposes it when the owner asks (proves H2 is real)", await canConnect(ext, ai.port));
        record("H3b ...and says so loudly in the log (no AUTH_TOKEN)", /WARNING: listening beyond this machine without AUTH_TOKEN/.test(ai.getLog()));
      });
    });

    await guard("C", () => withAi({}, async (ai) => {
      let r = await send(ai, { headers: { origin: "http://localhost:5173" }, body: { prompt: "hi" } });
      record("C1 allowed dev origin: 200, origin echoed (not '*'), Vary: Origin",
        r.status === 200 && r.headers.get("access-control-allow-origin") === "http://localhost:5173" && /Origin/.test(r.headers.get("vary") ?? ""), `${r.status} acao=${r.headers.get("access-control-allow-origin")}`);
      r = await send(ai, { headers: { origin: "http://evil.example" }, body: { prompt: "hi" } });
      const j = await r.json();
      record("C2 foreign origin: 403, says how to fix it, no CORS headers", r.status === 403 && /ALLOWED_ORIGINS/.test(j.error) && r.headers.get("access-control-allow-origin") === null, `${r.status} ${JSON.stringify(j)}`);
      r = await send(ai, { body: { prompt: "hi" } });
      record("C3 no Origin (curl/server): works, no CORS headers", r.status === 200 && r.headers.get("access-control-allow-origin") === null);
      r = await send(ai, { method: "OPTIONS", headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" } });
      record("C4 preflight from an allowed origin: 204 with methods and headers",
        r.status === 204 && /POST/.test(r.headers.get("access-control-allow-methods") ?? "") && /DELETE/.test(r.headers.get("access-control-allow-methods") ?? "") && /Content-Type/.test(r.headers.get("access-control-allow-headers") ?? ""), `${r.status}`);
      r = await send(ai, { method: "OPTIONS", headers: { origin: "http://evil.example" } });
      record("C5 preflight from a foreign origin: 403", r.status === 403, `${r.status}`);
      r = await send(ai, { headers: { origin: "http://localhost:5173.evil.example" }, body: { prompt: "hi" } });
      record("C5b look-alike origin is refused (exact match)", r.status === 403);
      r = await fetch(url(ai, "/health"), { headers: { origin: "http://evil.example" } });
      record("C5c even /health refuses a foreign browser origin", r.status === 403);
    }));

    await guard("C6", async () => {
      await withAi({ ALLOWED_ORIGINS: "https://maps.example.com" }, async (ai) => {
        let r = await send(ai, { headers: { origin: "https://maps.example.com" }, body: { prompt: "hi" } });
        const ok = r.status === 200;
        r = await send(ai, { headers: { origin: "http://localhost:5173" }, body: { prompt: "hi" } });
        record("C6 ALLOWED_ORIGINS replaces the defaults", ok && r.status === 403, `custom ok=${ok}, default now ${r.status}`);
      });
      await withAi({ ALLOWED_ORIGINS: "*" }, async (ai) => {
        const r = await send(ai, { headers: { origin: "http://anything.example" }, body: { prompt: "hi" } });
        record("C7 ALLOWED_ORIGINS=* allows every origin (explicit opt-in)", r.status === 200 && r.headers.get("access-control-allow-origin") === "*");
      });
    });

    await guard("T", () => withAi({ AUTH_TOKEN: "s3cret" }, async (ai) => {
      let r = await send(ai, { body: { prompt: "hi" } });
      record("T1 token set: no Authorization -> 401 with message", r.status === 401 && /access token/.test((await r.json()).error), `${r.status}`);
      r = await send(ai, { headers: { authorization: "Bearer nope" }, body: { prompt: "hi" } });
      record("T2 wrong token -> 401", r.status === 401);
      r = await send(ai, { headers: { authorization: "Bearer s3cret" }, body: { prompt: "hi" } });
      record("T3 right token -> 200", r.status === 200);
      r = await send(ai, { method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
      record("T4 preflight needs no token (browsers cannot send one there)", r.status === 204);
      r = await fetch(url(ai, "/health"));
      record("T5 /health needs no token", r.status === 200);
      r = await send(ai, { method: "DELETE", path: "/api/conversations/some-map-id1" });
      record("T6 DELETE needs the token too", r.status === 401);
      r = await send(ai, { method: "DELETE", path: "/api/conversations/some-map-id1", headers: { authorization: "Bearer s3cret" } });
      record("T7 ...and works with it", r.status === 204);
      r = await send(ai, { headers: { authorization: "Bearer s3cret", accept: "application/x-ndjson" }, body: { prompt: "hi" } });
      record("T8 token also works for the progress stream", r.status === 200);
      await r.text();
    }));

    await guard("R", async () => {
      await withAi({ RATE_LIMIT_PER_MINUTE: "3" }, async (ai) => {
        const statuses = [];
        for (let i = 0; i < 5; i++) statuses.push((await send(ai, { body: { prompt: "hi" } })).status);
        record("R1 the 4th request in a minute is refused with 429 (3 allowed)", statuses.join() === "200,200,200,429,429", statuses.join());
        const r = await send(ai, { body: { prompt: "hi" } });
        const j = await r.json();
        record("R2 429 carries Retry-After and a message with the wait time",
          r.status === 429 && Number(r.headers.get("retry-after")) >= 1 && /wait \d+ seconds/.test(j.error), `${r.status} retry-after=${r.headers.get("retry-after")} ${JSON.stringify(j)}`);
        const h = await fetch(url(ai, "/health"));
        record("R3 /health is never rate limited", h.status === 200);
        const d = await send(ai, { method: "DELETE", path: "/api/conversations/some-map-id1" });
        record("R3b DELETE (new map) is not blocked by the chat limit", d.status === 204);
      });
      await withAi({ RATE_LIMIT_PER_MINUTE: "0" }, async (ai) => {
        let bad = 0;
        for (let i = 0; i < 12; i++) if ((await send(ai, { body: { prompt: "hi" } })).status !== 200) bad++;
        record("R4 RATE_LIMIT_PER_MINUTE=0 turns the limit off", bad === 0, `refused=${bad}`);
      });
    });

    await guard("B", async () => {
      await withAi({ MAX_BODY_BYTES: "300" }, async (ai) => {
        let r = await send(ai, { body: { prompt: "x".repeat(900) } });
        const j = await r.json().catch(() => ({}));
        record("B1 body over MAX_BODY_BYTES -> 413 with message", r.status === 413 && /too large/.test(j.error ?? ""), `${r.status} ${JSON.stringify(j)}`);
        const status = await new Promise((resolve) => {
          const req = http.request({ host: "127.0.0.1", port: ai.port, path: "/api/chat", method: "POST", headers: { "content-type": "application/json", "transfer-encoding": "chunked" } },
            (res) => { res.resume(); resolve(res.statusCode); });
          req.on("error", () => resolve("closed"));
          req.write('{"prompt":"' + "y".repeat(200));
          setTimeout(() => { req.write("y".repeat(400)); req.end('"}'); }, 50);
          setTimeout(() => resolve("timeout"), 4000);
        });
        record("B2 a chunked body without Content-Length is cut off as well", status === 413 || status === "closed", `${status}`);
        r = await send(ai, { body: { prompt: "hi" } });
        record("B3 normal requests still work afterwards", r.status === 200, `${r.status}`);
      });
      await withAi({}, async (ai) => {
        let r = await send(ai, { body: { prompt: "x".repeat(2000) } });
        record("B4 under the body cap but over the prompt limit: still the friendly 400", r.status === 400 && /too long/.test((await r.json()).error), `${r.status}`);
        r = await send(ai, { body: "{not json" });
        record("B5 broken JSON -> 400", r.status === 400);
        r = await send(ai, { body: "[1,2]" });
        record("B5b a JSON array instead of an object -> 400", r.status === 400);
        r = await send(ai, { path: "/api/other", body: {} });
        record("B6 unknown route -> 404", r.status === 404);
      });
    });

    await guard("M", async () => {
      await withAi({ MCP_AUTH_TOKEN: "mcp-secret" }, async (ai) => {
        const r = await chat(ai.port, { prompt: "hi" });
        record("M1 ai-server presents MCP_AUTH_TOKEN: a token-protected MCP server works end to end", r.status === 200, `${r.status} ${r.text.slice(0, 100)}`);
      }, { mcp: TOKEN_MCP });
      await withAi({}, async (ai) => {
        const r = await chat(ai.port, { prompt: "hi" });
        record("M2 without the token the protected MCP server refuses -> clear 502", r.status === 502 && /map server could not be reached/.test(r.json?.error ?? ""), `${r.status} ${r.text.slice(0, 100)}`);
      }, { mcp: TOKEN_MCP });
    });
  } finally { await stop(mcp); await stop(mcpTok); }
  finish();
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
