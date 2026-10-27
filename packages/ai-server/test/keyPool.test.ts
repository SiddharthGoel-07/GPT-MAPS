import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyPool, retryAfterMs } from "../src/keyPool.ts";
import { ChatError } from "../src/errors.ts";

/* fake clock: sleep() advances time instead of waiting */
function setup(keys: string[], extra: Record<string, unknown> = {}) {
  const clock = { t: 1_000_000 };
  const sleeps: number[] = [];
  const logs: string[] = [];
  const pool = new KeyPool({
    keys,
    now: () => clock.t,
    sleep: async (ms) => { sleeps.push(ms); clock.t += ms; },
    random: () => 1,
    log: (m) => logs.push(m),
    ...extra,
  });
  const ctx = (budgetMs = 60_000) => ({ signal: new AbortController().signal, deadlineAt: clock.t + budgetMs });
  return { pool, clock, sleeps, logs, ctx };
}
const httpError = (status: number | undefined, message = "x", headers: Record<string, string> = {}) =>
  Object.assign(new Error(message), { status, headers });

test("retryAfterMs: retry-after-ms, seconds, http-date, message formats, none", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(retryAfterMs(httpError(429, "x", { "retry-after-ms": "250" }), now), 250);
  assert.equal(retryAfterMs(httpError(429, "x", { "retry-after": "7" }), now), 7000);
  assert.equal(retryAfterMs(httpError(429, "x", { "retry-after": "Thu, 01 Jan 2026 00:00:30 GMT" }), now), 30_000);
  assert.equal(retryAfterMs(httpError(429, "Rate limit. Please try again in 7.2s."), now), 7200);
  assert.equal(retryAfterMs(httpError(429, "Please try again in 1m3.4s"), now), 63_400);
  assert.equal(retryAfterMs(httpError(429, "Please try again in 250ms"), now), 250);
  assert.equal(retryAfterMs(httpError(429, "nothing useful"), now), undefined);
  // Headers object with get()
  const err = Object.assign(new Error("x"), { status: 429, headers: new Headers({ "retry-after": "2" }) });
  assert.equal(retryAfterMs(err, now), 2000);
});

test("success returns result and remembers the good key", async () => {
  const { pool, ctx } = setup(["a", "b"]);
  const used: string[] = [];
  const call = async (k: string) => { used.push(k); if (k === "a") throw httpError(429, "x", { "retry-after-ms": "1000" }); return "ok"; };
  assert.equal(await pool.run(call, ctx()), "ok");
  assert.deepEqual(used, ["a", "b"]);
  used.length = 0;
  assert.equal(await pool.run(call, ctx()), "ok");
  assert.deepEqual(used, ["b"], "key a is cooling, b is tried first");
});

test("429 puts only that key on cooldown, and it comes back after the cooldown", async () => {
  const { pool, clock, ctx } = setup(["a", "b"]);
  const used: string[] = [];
  let aLimited = true;
  const call = async (k: string) => { used.push(k); if (k === "a" && aLimited) throw httpError(429, "x", { "retry-after-ms": "5000" }); return k; };
  await pool.run(call, ctx());            // a 429 -> b
  clock.t += 4000;
  used.length = 0; await pool.run(call, ctx());
  assert.deepEqual(used, ["b"], "still cooling at +4s");
  clock.t += 2000; aLimited = false;
  // cursor sits on b (last good) so b still serves; make b fail to force a
  used.length = 0;
  await pool.run(async (k) => { used.push(k); if (k === "b") throw httpError(429, "x", { "retry-after-ms": "100000" }); return k; }, ctx());
  assert.deepEqual(used, ["b", "a"], "a is usable again after its cooldown");
});

test("all keys cooling: waits for the soonest one, then succeeds", async () => {
  const { pool, sleeps, ctx } = setup(["a", "b"]);
  let calls = 0;
  const result = await pool.run(async () => {
    calls++;
    if (calls === 1) throw httpError(429, "x", { "retry-after-ms": "3000" });
    if (calls === 2) throw httpError(429, "x", { "retry-after-ms": "1000" });
    return "ok";
  }, ctx());
  assert.equal(result, "ok");
  assert.deepEqual(sleeps, [1000], "waited for b (the soonest), not a");
});

test("all keys cooling and the wait does not fit the deadline: fails at once with 503, no sleep", async () => {
  const { pool, sleeps, ctx } = setup(["a"]);
  await assert.rejects(
    pool.run(async () => { throw httpError(429, "x", { "retry-after-ms": "30000" }); }, ctx(5000)),
    (e: unknown) => e instanceof ChatError && e.status === 503 && /rate limited/.test(e.message)
  );
  assert.deepEqual(sleeps, []);
});

test("cooldown is capped (maxCooldownMs) and defaults when no hint is given", async () => {
  const { pool, sleeps, ctx } = setup(["a"], { maxCooldownMs: 2000, defaultCooldownMs: 700 });
  let n = 0;
  await pool.run(async () => { if (++n === 1) throw httpError(429, "no hint"); return "ok"; }, ctx());
  assert.deepEqual(sleeps, [700]);
  n = 0; sleeps.length = 0;
  await pool.run(async () => { if (++n === 1) throw httpError(429, "x", { "retry-after": "999" }); return "ok"; }, ctx());
  assert.deepEqual(sleeps, [2000]);
});

test("401/403 disable the key for good; all disabled -> 503", async () => {
  const { pool, ctx } = setup(["a", "b"]);
  const used: string[] = [];
  const call = async (k: string) => { used.push(k); if (k === "a") throw httpError(401); return "ok"; };
  await pool.run(call, ctx());
  used.length = 0; await pool.run(call, ctx());
  assert.deepEqual(used, ["b"], "a is never tried again");

  const bad = setup(["a", "b"]);
  await assert.rejects(
    bad.pool.run(async () => { throw httpError(403); }, bad.ctx()),
    (e: unknown) => e instanceof ChatError && e.status === 503 && /No usable/.test(e.message)
  );
});

test("400-class errors are not retried and do not rotate keys", async () => {
  for (const status of [400, 404, 413, 422]) {
    const { pool, ctx } = setup(["a", "b"]);
    let calls = 0;
    await assert.rejects(
      pool.run(async () => { calls++; throw httpError(status); }, ctx()),
      (e: unknown) => e instanceof ChatError && e.status === 502 && e.message.includes(String(status))
    );
    assert.equal(calls, 1, `status ${status}`);
  }
});

test("transient errors (5xx, 408, network) back off exponentially, then give up with 502", async () => {
  for (const status of [500, 503, 408, undefined]) {
    const { pool, sleeps, ctx } = setup(["a"], { backoffBaseMs: 100 });
    let calls = 0;
    await assert.rejects(
      pool.run(async () => { calls++; throw httpError(status); }, ctx()),
      (e: unknown) => e instanceof ChatError && e.status === 502
    );
    assert.equal(calls, 3, `1 try + 2 retries (status ${status})`);
    assert.deepEqual(sleeps, [100, 200]);
  }
});

test("transient error then success", async () => {
  const { pool, ctx } = setup(["a"]);
  let calls = 0;
  assert.equal(await pool.run(async () => { if (++calls === 1) throw httpError(500); return "ok"; }, ctx()), "ok");
});

test("an aborted request stops immediately and surfaces the abort reason", async () => {
  const { pool } = setup(["a"]);
  const controller = new AbortController();
  const reason = new ChatError(504, "deadline");
  controller.abort(reason);
  let calls = 0;
  await assert.rejects(
    pool.run(async () => { calls++; return "x"; }, { signal: controller.signal, deadlineAt: Date.now() + 1000 }),
    (e: unknown) => e === reason
  );
  assert.equal(calls, 0);

  // abort during a call: the SDK's AbortError is replaced by the reason
  const c2 = new AbortController();
  await assert.rejects(
    pool.run(async () => { c2.abort(reason); throw Object.assign(new Error("aborted"), { name: "AbortError" }); }, { signal: c2.signal, deadlineAt: Date.now() + 1000 }),
    (e: unknown) => e === reason
  );
});

test("maxAttempts bounds the work", async () => {
  const { pool, ctx } = setup(["a", "b"], { maxAttempts: 4, defaultCooldownMs: 1 });
  let calls = 0;
  await assert.rejects(
    pool.run(async () => { calls++; throw httpError(429); }, ctx()),
    (e: unknown) => e instanceof ChatError && e.status === 503
  );
  assert.ok(calls <= 4);
});
