import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DEFAULT_ALLOWED_ORIGINS, readConversationConfig, readServerConfig } from "../src/config.ts";
import { ChatError } from "../src/errors.ts";
import { RateLimiter, applyCors, checkToken, readBodyLimited, tokenMatches } from "../src/security.ts";

/* ------------------------------ config ------------------------------ */

test("readServerConfig: safe defaults (localhost only, dev origins, 16 KB, 20/min, no token)", () => {
  const c = readServerConfig({});
  assert.equal(c.host, "127.0.0.1");
  assert.deepEqual([...c.allowedOrigins], [...DEFAULT_ALLOWED_ORIGINS]);
  assert.equal(c.maxBodyBytes, 16 * 1024);
  assert.equal(c.rateLimitPerMinute, 20);
  assert.equal(c.authToken, undefined);
  assert.equal(c.mcpAuthToken, undefined);
});

test("readServerConfig: environment overrides; junk values fall back", () => {
  const c = readServerConfig({ HOST: "0.0.0.0", ALLOWED_ORIGINS: "https://a.test, https://b.test", MAX_BODY_BYTES: "500", RATE_LIMIT_PER_MINUTE: "0", AUTH_TOKEN: " t ", MCP_AUTH_TOKEN: "m" });
  assert.equal(c.host, "0.0.0.0");
  assert.deepEqual([...c.allowedOrigins], ["https://a.test", "https://b.test"]);
  assert.equal(c.maxBodyBytes, 500);
  assert.equal(c.rateLimitPerMinute, 0); // 0 = unlimited is allowed
  assert.equal(c.authToken, "t");
  assert.equal(c.mcpAuthToken, "m");
  const junk = readServerConfig({ MAX_BODY_BYTES: "-1", RATE_LIMIT_PER_MINUTE: "abc", ALLOWED_ORIGINS: " , " });
  assert.equal(junk.maxBodyBytes, 16 * 1024);
  assert.equal(junk.rateLimitPerMinute, 20);
  assert.deepEqual([...junk.allowedOrigins], [...DEFAULT_ALLOWED_ORIGINS]);
});

test("readConversationConfig: defaults keep the idle TTL below the MCP server's 10 minutes", () => {
  const c = readConversationConfig({});
  assert.ok(c.ttlMs < 10 * 60_000);
  assert.equal(c.maxConversations, 50);
  assert.equal(readConversationConfig({ MAX_CONVERSATIONS: "3", CONVERSATION_TTL_MS: "1000" }).maxConversations, 3);
});

/* ---------------------------- rate limiter ---------------------------- */

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("RateLimiter: allows `limit` requests, then says how long to wait", () => {
  const c = clock();
  const rl = new RateLimiter(3, 60_000, 100, c.now);
  assert.equal(rl.check("ip"), null);
  c.advance(1000); assert.equal(rl.check("ip"), null);
  c.advance(1000); assert.equal(rl.check("ip"), null);
  c.advance(1000);
  assert.equal(rl.check("ip"), 57); // first hit (t0) frees up at t0+60s; now t0+3s
});

test("RateLimiter: the window slides (old hits stop counting)", () => {
  const c = clock();
  const rl = new RateLimiter(2, 60_000, 100, c.now);
  rl.check("ip"); c.advance(30_000); rl.check("ip");
  assert.notEqual(rl.check("ip"), null);
  c.advance(30_001); // first hit is now > 60 s old
  assert.equal(rl.check("ip"), null);
  assert.notEqual(rl.check("ip"), null);
});

test("RateLimiter: clients are independent; blocked attempts do not extend the block", () => {
  const c = clock();
  const rl = new RateLimiter(1, 60_000, 100, c.now);
  assert.equal(rl.check("a"), null);
  assert.equal(rl.check("b"), null);
  assert.notEqual(rl.check("a"), null);
  c.advance(10_000); rl.check("a"); rl.check("a"); // hammering while blocked
  c.advance(50_001);
  assert.equal(rl.check("a"), null, "unblocked 60 s after the ONE counted request");
});

test("RateLimiter: limit 0 means no limit", () => {
  const rl = new RateLimiter(0);
  for (let i = 0; i < 1000; i++) assert.equal(rl.check("ip"), null);
  assert.equal(rl.size, 0);
});

test("RateLimiter: memory is bounded (maxKeys) and sweep drops idle clients", () => {
  const c = clock();
  const rl = new RateLimiter(5, 60_000, 3, c.now);
  for (const ip of ["a", "b", "c", "d", "e"]) rl.check(ip);
  assert.ok(rl.size <= 3, `size=${rl.size}`);
  c.advance(61_000);
  rl.sweep();
  assert.equal(rl.size, 0);
});

/* ------------------------------ token ------------------------------ */

test("tokenMatches / checkToken", () => {
  assert.equal(tokenMatches("Bearer abc", "abc"), true);
  assert.equal(tokenMatches("Bearer abd", "abc"), false);
  assert.equal(tokenMatches("abc", "abc"), false);
  assert.equal(tokenMatches(undefined, "abc"), false);
  const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as unknown as IncomingMessage;
  assert.equal(checkToken(req(), readServerConfig({})), null, "no token configured -> open");
  const cfg = readServerConfig({ AUTH_TOKEN: "abc" });
  assert.equal(checkToken(req(), cfg)?.status, 401);
  assert.equal(checkToken(req("Bearer nope"), cfg)?.status, 401);
  assert.equal(checkToken(req("Bearer abc"), cfg), null);
});

/* ------------------------------- CORS ------------------------------- */

function fakeRes() {
  const headers: Record<string, string> = {};
  return { headers, res: { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as ServerResponse };
}
const reqWithOrigin = (origin?: string) => ({ headers: origin ? { origin } : {} }) as unknown as IncomingMessage;

test("applyCors: a listed origin is echoed back (not '*') with Vary: Origin", () => {
  const { headers, res } = fakeRes();
  const problem = applyCors(reqWithOrigin("http://localhost:5173"), res, readServerConfig({}));
  assert.equal(problem, null);
  assert.equal(headers["Access-Control-Allow-Origin"], "http://localhost:5173");
  assert.equal(headers["Vary"], "Origin");
  assert.match(headers["Access-Control-Allow-Methods"] ?? "", /DELETE/);
  assert.match(headers["Access-Control-Allow-Headers"] ?? "", /Authorization/);
});

test("applyCors: an unlisted origin gets 403 and NO CORS headers", () => {
  const { headers, res } = fakeRes();
  const problem = applyCors(reqWithOrigin("http://evil.example"), res, readServerConfig({}));
  assert.ok(problem instanceof ChatError);
  assert.equal(problem.status, 403);
  assert.match(problem.message, /ALLOWED_ORIGINS/);
  assert.equal(headers["Access-Control-Allow-Origin"], undefined);
});

test("applyCors: no Origin header (curl, servers) is allowed and gets no CORS headers", () => {
  const { headers, res } = fakeRes();
  assert.equal(applyCors(reqWithOrigin(), res, readServerConfig({})), null);
  assert.equal(headers["Access-Control-Allow-Origin"], undefined);
});

test("applyCors: '*' allows any origin", () => {
  const { headers, res } = fakeRes();
  assert.equal(applyCors(reqWithOrigin("http://x.test"), res, readServerConfig({ ALLOWED_ORIGINS: "*" })), null);
  assert.equal(headers["Access-Control-Allow-Origin"], "*");
});

/* ---------------------------- body limit ---------------------------- */

function body(headers: Record<string, string> = {}) {
  const s = new PassThrough() as PassThrough & { headers: Record<string, string> };
  s.headers = headers;
  return s;
}

test("readBodyLimited: small body ok; exactly the limit ok", async () => {
  const a = body(); const pa = readBodyLimited(a as unknown as IncomingMessage, 11); a.end("hello world");
  assert.equal((await pa).toString(), "hello world");
});

test("readBodyLimited: declared Content-Length too big -> 413 immediately", async () => {
  await assert.rejects(readBodyLimited(body({ "content-length": "99999" }) as unknown as IncomingMessage, 100), (e) => e instanceof ChatError && e.status === 413);
});

test("readBodyLimited: undeclared body that grows too big -> 413", async () => {
  const s = body(); const p = readBodyLimited(s as unknown as IncomingMessage, 8);
  s.write("12345"); s.write("6789");
  await assert.rejects(p, (e) => e instanceof ChatError && e.status === 413);
});
