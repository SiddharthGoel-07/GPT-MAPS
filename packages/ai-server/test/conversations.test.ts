import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationStore } from "../src/conversations.ts";
import type { McpConnectionLike } from "../src/conversations.ts";
import type { McpLike } from "../src/chatLoop.ts";
import { ChatError } from "../src/errors.ts";

const signal = new AbortController().signal;

interface FakeConn extends McpConnectionLike { closed: boolean; pings: number; failPing: boolean; id: number }

function setup(over: { ttlMs?: number; maxConversations?: number } = {}) {
  let now = 1_000_000;
  const conns: FakeConn[] = [];
  let failConnect = false;
  const store = new ConversationStore({
    now: () => now,
    connect: async () => {
      if (failConnect) throw new Error("mcp down");
      const conn: FakeConn = {
        id: conns.length, closed: false, pings: 0, failPing: false,
        mcp: {
          async listTools() { conn.pings++; if (conn.failPing) throw new Error("session not found"); return []; },
          async callTool() { return { text: "{}", isError: false }; },
        } as McpLike,
        async close() { conn.closed = true; },
      };
      conns.push(conn);
      return conn;
    },
    ttlMs: over.ttlMs ?? 1000,
    maxConversations: over.maxConversations ?? 3,
  });
  return { store, conns, advance: (ms: number) => (now += ms), setFailConnect: (v: boolean) => (failConnect = v) };
}

const ID = (n: number) => `conversation-${n}`;

test("a new id opens a conversation; the same id later CONTINUES it (one connection, history kept)", async () => {
  const { store, conns } = setup();
  const a = await store.acquire(ID(1), signal);
  assert.equal(a.resumed, false);
  assert.deepEqual(a.history, []);
  a.commit("show Delhi", "Done.");
  await a.release();

  const b = await store.acquire(ID(1), signal);
  assert.equal(b.resumed, true);
  assert.deepEqual(b.history, [{ role: "user", content: "show Delhi" }, { role: "assistant", content: "Done." }]);
  assert.equal(conns.length, 1, "no second MCP connection");
  assert.equal(conns[0]!.pings, 1, "continuing proves the session is alive with one round trip");
  assert.equal(conns[0]!.closed, false);
  await b.release();
});

test("different ids are different maps", async () => {
  const { store, conns } = setup();
  const a = await store.acquire(ID(1), signal);
  const b = await store.acquire(ID(2), signal);
  assert.notEqual(a.mcp, b.mcp);
  assert.equal(conns.length, 2);
  assert.equal(store.size, 2);
});

test("an invalid id is a 400", async () => {
  const { store } = setup();
  for (const bad of ["short", "has space here", "x".repeat(65), "../../etc/passwd", "ünïcode-id-1234"]) {
    await assert.rejects(store.acquire(bad, signal), (e) => e instanceof ChatError && e.status === 400, bad);
  }
});

test("one request at a time per conversation: a parallel one gets 409, and works after release", async () => {
  const { store } = setup();
  const a = await store.acquire(ID(1), signal);
  await assert.rejects(store.acquire(ID(1), signal), (e) => e instanceof ChatError && e.status === 409);
  await a.release();
  const b = await store.acquire(ID(1), signal);
  assert.equal(b.resumed, true);
});

test("two parallel requests for the SAME NEW id: exactly one wins (409 for the other), one connection", async () => {
  const { store, conns } = setup();
  const results = await Promise.allSettled([store.acquire(ID(7), signal), store.acquire(ID(7), signal)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal((rejected.reason as ChatError).status, 409);
  assert.equal(conns.length, 1);
});

test("a lost MCP session is replaced by a fresh one: not resumed, history cleared, old connection closed", async () => {
  const { store, conns } = setup();
  const a = await store.acquire(ID(1), signal);
  a.commit("show Delhi", "Done.");
  await a.release();
  conns[0]!.failPing = true; // server forgot the session (TTL / restart)

  const b = await store.acquire(ID(1), signal);
  assert.equal(b.resumed, false);
  assert.deepEqual(b.history, []);
  assert.equal(conns.length, 2);
  assert.equal(conns[0]!.closed, true);
  assert.notEqual(b.mcp, a.mcp);
  await b.release();
  const c = await store.acquire(ID(1), signal);
  assert.equal(c.resumed, true, "the replacement is a normal conversation again");
});

test("an abort during the liveness check is rethrown (no silent new map) and does not leave the conversation stuck busy", async () => {
  const { store, conns } = setup();
  const a = await store.acquire(ID(1), signal);
  await a.release();
  conns[0]!.failPing = true;
  const controller = new AbortController();
  controller.abort(new Error("deadline"));
  await assert.rejects(store.acquire(ID(1), controller.signal), /session not found/);
  assert.equal(conns.length, 1, "no reconnect attempted");
  conns[0]!.failPing = false;
  const again = await store.acquire(ID(1), signal);
  assert.equal(again.resumed, true);
});

test("a failing connect leaves nothing behind and can be retried", async () => {
  const { store, setFailConnect } = setup();
  setFailConnect(true);
  await assert.rejects(store.acquire(ID(1), signal), /mcp down/);
  assert.equal(store.size, 0);
  setFailConnect(false);
  const a = await store.acquire(ID(1), signal);
  assert.equal(a.resumed, false);
});

test("one-shot (no id): own connection, closed on release, never stored", async () => {
  const { store, conns } = setup();
  const lease = await store.acquire(undefined, signal);
  assert.equal(lease.id, undefined);
  assert.equal(store.size, 0);
  lease.commit("x", "y"); // no-op, must not throw
  await lease.release();
  assert.equal(conns[0]!.closed, true);
});

test("idle conversations are closed after the TTL; busy ones never are", async () => {
  const { store, conns, advance } = setup({ ttlMs: 1000 });
  const idle = await store.acquire(ID(1), signal); await idle.release();
  const busy = await store.acquire(ID(2), signal);
  advance(1500);
  await store.sweep();
  assert.equal(conns[0]!.closed, true);
  assert.equal(conns[1]!.closed, false);
  assert.equal(store.size, 1);
  await busy.release();
  advance(500); await store.sweep();
  assert.equal(conns[1]!.closed, false, "TTL counts from the end of the last request");
  advance(600); await store.sweep();
  assert.equal(conns[1]!.closed, true);
});

test("at the cap the least recently used IDLE conversation is evicted", async () => {
  const { store, conns, advance } = setup({ maxConversations: 2 });
  const a = await store.acquire(ID(1), signal); await a.release(); advance(10);
  const b = await store.acquire(ID(2), signal); await b.release(); advance(10);
  const c = await store.acquire(ID(3), signal);
  assert.equal(conns[0]!.closed, true, "oldest idle (1) evicted");
  assert.equal(conns[1]!.closed, false);
  assert.equal(store.size, 2);
  await c.release();
});

test("at the cap with everything busy -> 503, and the failed attempt leaves no ghost entry", async () => {
  const { store } = setup({ maxConversations: 2 });
  await store.acquire(ID(1), signal); await store.acquire(ID(2), signal);
  await assert.rejects(store.acquire(ID(3), signal), (e) => e instanceof ChatError && e.status === 503);
  assert.equal(store.size, 2);
});

test("remove(): closes the conversation; unknown id -> false; busy -> 409", async () => {
  const { store, conns } = setup();
  const a = await store.acquire(ID(1), signal);
  await assert.rejects(store.remove(ID(1)), (e) => e instanceof ChatError && e.status === 409);
  await a.release();
  assert.equal(await store.remove(ID(1)), true);
  assert.equal(conns[0]!.closed, true);
  assert.equal(await store.remove(ID(1)), false);
  const again = await store.acquire(ID(1), signal);
  assert.equal(again.resumed, false, "after remove the id starts a fresh map");
});

test("history keeps only the last 6 turns and clips long texts", async () => {
  const { store } = setup();
  const a = await store.acquire(ID(1), signal);
  for (let i = 0; i < 10; i++) a.commit(`prompt ${i}`, `answer ${i}`);
  a.commit("p".repeat(5000), "a".repeat(5000));
  await a.release();
  const b = await store.acquire(ID(1), signal);
  assert.equal(b.history.length, 12);
  assert.equal(b.history[0]!.content, "prompt 5");
  assert.ok(b.history.at(-1)!.content.length <= 600);
  assert.ok(b.history.at(-2)!.content.length <= 600);
});

test("a lease's history is a snapshot: changing it cannot corrupt the store", async () => {
  const { store } = setup();
  const a = await store.acquire(ID(1), signal);
  a.commit("one", "two"); await a.release();
  const b = await store.acquire(ID(1), signal);
  (b.history as unknown as unknown[]).push({ role: "user", content: "tampered" });
  await b.release();
  const c = await store.acquire(ID(1), signal);
  assert.equal(c.history.length, 2);
});

test("closeAll closes every connection", async () => {
  const { store, conns } = setup();
  await (await store.acquire(ID(1), signal)).release();
  await (await store.acquire(ID(2), signal)).release();
  await store.closeAll();
  assert.ok(conns.every((c) => c.closed));
  assert.equal(store.size, 0);
});
