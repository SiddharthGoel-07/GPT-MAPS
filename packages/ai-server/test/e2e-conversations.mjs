/* eslint-disable */
// B5 (a map that lives across prompts) and F1 (progress stream, accurate errors), black-box.
//   fake Groq  <--  REAL ai-server (dist)  -->  REAL MCP server (dist, network stubbed)
// Usage (repo root, after building shared, server, ai-server):  node packages/ai-server/test/e2e-conversations.mjs
// Ports: MCP 4001 / 4002 (short session TTL) / 4003 (never started); ai-server 4011+; fake Groq 4021+.
import { AI_JS, byType, chat, chatStream, completion, createReporter, mcpSessions, sleep, startAi, startGroq, startMcp, stop } from "./harness.mjs";

const { record, guard, finish } = createReporter();
const MCP = 4001, MCP_SHORT = 4002, MCP_DEAD = 4003;
let nextAi = 4011, nextGroq = 4021;

const lastUser = (body) => [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
const lastRole = (body) => body.messages.at(-1)?.role;

/** A scripted "model": decides by the newest user message; after tool results it just says Done. */
function scripted({ body }) {
  if (lastRole(body) === "tool") return { json: completion("Done.") };
  const raw = String(lastUser(body));
  const u = raw.includes("User request: ") ? raw.split("User request: ").pop() : raw; // ignore the map-context preamble
  if (u.includes("boom")) return { status: 400, json: { error: { message: "bad request", type: "x" } } };
  if (u.includes("slow")) return { delayMs: 900, json: completion("Slow done.") };
  if (u.includes("hang")) return { hang: true };
  if (u.includes("start over")) return { json: completion(null, [["clearScene", {}], ["createMarker", { location: "Pune" }]]) };
  if (u.includes("remove Delhi")) return { json: completion(null, [["removeObject", { name: "Delhi" }]]) };
  if (u.includes("add Mumbai")) return { json: completion(null, [["createMarker", { location: "Mumbai" }]]) };
  if (u.includes("show Delhi")) return { json: completion(null, [["createMarker", { location: "Delhi" }]]) };
  return { json: completion("Nothing to draw.") };
}

async function scenario(handler, env, fn, { mcp = MCP } = {}) {
  const groq = await startGroq(nextGroq++, handler);
  let ai;
  try {
    ai = await startAi(nextAi++, mcp, groq.port, env);
    await fn({ groq, ai, say: (body, opts) => chat(ai.port, body, opts), stream: (body, opts) => chatStream(ai.port, body, opts) });
  } finally { if (ai) await stop(ai.child); groq.close(); }
}
const names = (scene, t) => byType(scene, t).map((o) => o.name);

async function main() {
  const mcp = await startMcp(MCP);
  const mcpShort = await startMcp(MCP_SHORT, { SESSION_TTL_MS: "700", SESSION_SWEEP_MS: "100" });
  {
    /* --------------------------- persistence across prompts --------------------------- */
    await guard("C", () => scenario(scripted, {}, async ({ say, groq, ai }) => {
      const base = await mcpSessions(MCP);
      let r = await say({ prompt: "show Delhi", conversationId: "map-aaaaaaaa" });
      record("C1 first prompt of a conversation: echoes the id, marks it new, draws Delhi",
        r.status === 200 && r.json?.conversationId === "map-aaaaaaaa" && r.json?.isNewConversation === true && byType(r.json?.scene, "marker").length === 1,
        `status=${r.status} ${JSON.stringify(r.json && { id: r.json.conversationId, isNew: r.json.isNewConversation })}`);
      await sleep(200);
      record("C1b the MCP session is KEPT open between prompts", (await mcpSessions(MCP)) === base + 1, `sessions=${await mcpSessions(MCP)} base=${base}`);
      const firstUser = groq.requests[0].body.messages.filter((m) => m.role === "user");
      record("C1c the very first prompt reaches the model unchanged (no map context, no history)", firstUser.length === 1 && firstUser[0].content === "show Delhi", JSON.stringify(firstUser));

      const before = groq.requests.length;
      r = await say({ prompt: "add Mumbai", conversationId: "map-aaaaaaaa" });
      record("C2 follow-up ADDS to the same map (Delhi + Mumbai kept)",
        r.status === 200 && r.json?.isNewConversation === false && names(r.json?.scene, "marker").sort().join() === "Delhi,Mumbai", `markers=${names(r.json?.scene, "marker")} isNew=${r.json?.isNewConversation}`);
      record("C2b still exactly one MCP session for this conversation", (await mcpSessions(MCP)) === base + 1);
      const msgs = groq.requests[before].body.messages;
      const roles = msgs.map((m) => m.role).join();
      record("C2c the model gets the earlier turn (prompt + its answer) before the new prompt", roles.startsWith("system,user,assistant,user") && msgs[1].content === "show Delhi", roles);
      const lu = String(msgs.at(-1).content);
      record("C2d the new prompt carries a description of what is already on the map", /Markers: "Delhi"/.test(lu) && /User request: add Mumbai/.test(lu), lu.slice(0, 160));

      r = await say({ prompt: "show Delhi", conversationId: "map-bbbbbbbb" });
      record("C3 another conversation id is a separate map (Delhi only, not Mumbai) and a second session",
        r.json?.isNewConversation === true && names(r.json?.scene, "marker").join() === "Delhi" && (await mcpSessions(MCP)) === base + 2, `markers=${names(r.json?.scene, "marker")}`);

      r = await say({ prompt: "remove Delhi", conversationId: "map-aaaaaaaa" });
      record("C4 'remove Delhi' (model uses removeObject) leaves Mumbai only",
        r.status === 200 && names(r.json?.scene, "marker").join() === "Mumbai" && names(r.json?.scene, "label").join() === "Mumbai", `markers=${names(r.json?.scene, "marker")} labels=${names(r.json?.scene, "label")}`);

      r = await say({ prompt: "start over", conversationId: "map-aaaaaaaa" });
      record("C5 'start over' (clearScene then Pune) leaves only Pune", names(r.json?.scene, "marker").join() === "Pune" && r.json?.scene.objects.length === 2, `markers=${names(r.json?.scene, "marker")}`);
      for (const id of ["map-aaaaaaaa", "map-bbbbbbbb"]) await fetch(`http://127.0.0.1:${ai.port}/api/conversations/${id}`, { method: "DELETE" });
    }));
  }

  await guard("D", () => scenario(scripted, {}, async ({ say, ai }) => {
    const base = await mcpSessions(MCP);
    await say({ prompt: "show Delhi", conversationId: "map-delete-1" });
    const del = await fetch(`http://127.0.0.1:${ai.port}/api/conversations/map-delete-1`, { method: "DELETE" });
    await sleep(200);
    record("C6 DELETE /api/conversations/:id -> 204 and the MCP session is ended", del.status === 204 && (await mcpSessions(MCP)) === base, `status=${del.status} sessions=${await mcpSessions(MCP)} base=${base}`);
    const r = await say({ prompt: "add Mumbai", conversationId: "map-delete-1" });
    record("C6b after 'new map' the same id starts empty (Delhi is gone)", r.json?.isNewConversation === true && names(r.json?.scene, "marker").join() === "Mumbai", `markers=${names(r.json?.scene, "marker")}`);
    const again = await fetch(`http://127.0.0.1:${ai.port}/api/conversations/never-existed`, { method: "DELETE" });
    record("C6c DELETE of an unknown id is harmless (idempotent 204)", again.status === 204);
    await fetch(`http://127.0.0.1:${ai.port}/api/conversations/map-delete-1`, { method: "DELETE" });
  }));

  await guard("E", () => scenario(scripted, {}, async ({ say, ai }) => {
    const base = await mcpSessions(MCP);
    const r = await say({ prompt: "show Delhi" });
    await sleep(200);
    record("C7 without conversationId nothing changes: no extra fields, session closed afterwards (old behaviour)",
      r.status === 200 && r.json?.conversationId === undefined && r.json?.isNewConversation === undefined && Object.keys(r.json).sort().join() === "message,scene" && (await mcpSessions(MCP)) === base,
      `keys=${Object.keys(r.json ?? {})} sessions=${await mcpSessions(MCP)} base=${base}`);

    let bad = await say({ prompt: "show Delhi", conversationId: "bad id!" });
    record("C9 an invalid conversationId is a 400 with a message", bad.status === 400 && /conversationId/.test(bad.json?.error ?? ""), `${bad.status} ${bad.text.slice(0, 100)}`);
    bad = await say({ prompt: "show Delhi", conversationId: 12345678 });
    record("C9b a non-string conversationId is a 400", bad.status === 400 && /string/.test(bad.json?.error ?? ""), `${bad.status} ${bad.text.slice(0, 100)}`);
    await sleep(200);
    record("C9c rejected requests leave no session behind", (await mcpSessions(MCP)) === base);
  }));

  await guard("F", () => scenario(scripted, {}, async ({ say, ai }) => {
    const slow = say({ prompt: "slow one", conversationId: "map-busy-0001" });
    await sleep(250);
    const second = await say({ prompt: "show Delhi", conversationId: "map-busy-0001" });
    const first = await slow;
    record("C8 a second request on a busy conversation gets 409 with a clear message; the first still finishes",
      second.status === 409 && /still running/.test(second.json?.error ?? "") && first.status === 200, `first=${first.status} second=${second.status} ${second.text.slice(0, 80)}`);
    await fetch(`http://127.0.0.1:${ai.port}/api/conversations/map-busy-0001`, { method: "DELETE" });
  }));

  await guard("G", () => scenario(scripted, { MAX_CONVERSATIONS: "2" }, async ({ say, ai }) => {
    const base = await mcpSessions(MCP);
    await say({ prompt: "show Delhi", conversationId: "cap-aaaaaaaa" });
    await sleep(30);
    await say({ prompt: "show Delhi", conversationId: "cap-bbbbbbbb" });
    await sleep(30);
    await say({ prompt: "show Delhi", conversationId: "cap-cccccccc" });
    await sleep(300);
    record("C12 at MAX_CONVERSATIONS the oldest idle map is closed (2 sessions, not 3)", (await mcpSessions(MCP)) === base + 2, `sessions=${await mcpSessions(MCP)} base=${base}`);
    const r = await say({ prompt: "show Delhi", conversationId: "cap-aaaaaaaa" });
    record("C12b the evicted conversation starts fresh next time", r.status === 200 && r.json?.isNewConversation === true);
    await sleep(100);
    for (const id of ["cap-aaaaaaaa", "cap-bbbbbbbb", "cap-cccccccc"]) await fetch(`http://127.0.0.1:${ai.port}/api/conversations/${id}`, { method: "DELETE" });
  }));

  await guard("T", () => scenario(scripted, { CONVERSATION_TTL_MS: "500", CONVERSATION_SWEEP_MS: "100" }, async ({ say, ai }) => {
    const base = await mcpSessions(MCP);
    await say({ prompt: "show Delhi", conversationId: "ttl-aaaaaaaa" });
    const during = (await (await fetch(`http://127.0.0.1:${ai.port}/health`)).json()).activeConversations;
    await sleep(1300);
    const after = (await (await fetch(`http://127.0.0.1:${ai.port}/health`)).json()).activeConversations;
    record("C11 an idle conversation is closed after its TTL (ai-server and MCP session both gone)", during === 1 && after === 0 && (await mcpSessions(MCP)) === base, `during=${during} after=${after} sessions=${await mcpSessions(MCP)} base=${base}`);
    const r = await say({ prompt: "add Mumbai", conversationId: "ttl-aaaaaaaa" });
    record("C11b the id then simply starts a new map", r.json?.isNewConversation === true && names(r.json?.scene, "marker").join() === "Mumbai");
    await fetch(`http://127.0.0.1:${ai.port}/api/conversations/ttl-aaaaaaaa`, { method: "DELETE" });
  }));

  await guard("L", () => scenario(scripted, {}, async ({ say, ai }) => {
    await say({ prompt: "show Delhi", conversationId: "lost-bbbbbbbb" });
    await sleep(1600); // MCP_SHORT forgets idle sessions after 700 ms
    const r = await say({ prompt: "add Mumbai", conversationId: "lost-bbbbbbbb" });
    record("C10 the MCP server forgot the session: request still succeeds as a NEW map (flagged isNewConversation)",
      r.status === 200 && r.json?.isNewConversation === true && names(r.json?.scene, "marker").join() === "Mumbai", `status=${r.status} markers=${names(r.json?.scene, "marker")} ${r.text.slice(0, 120)}`);
    record("C10b it was logged", /MCP session lost/.test(ai.getLog()));
    await fetch(`http://127.0.0.1:${ai.port}/api/conversations/lost-bbbbbbbb`, { method: "DELETE" });
  }, { mcp: MCP_SHORT }));

  await guard("H", () => scenario(scripted, {}, async ({ say, groq, ai }) => {
    await say({ prompt: "show Delhi", conversationId: "fail-aaaaaaaa" });
    const bad = await say({ prompt: "boom", conversationId: "fail-aaaaaaaa" });
    const ok = await say({ prompt: "add Mumbai", conversationId: "fail-aaaaaaaa" });
    const lastBody = groq.requests.at(-2).body.messages.map((m) => String(m.content));
    record("C13 a failed turn does not destroy the map: next prompt still sees Delhi and adds Mumbai",
      bad.status !== 200 && ok.status === 200 && ok.json?.isNewConversation === false && names(ok.json?.scene, "marker").sort().join() === "Delhi,Mumbai", `bad=${bad.status} ok=${ok.status} markers=${names(ok.json?.scene, "marker")}`);
    record("C13b the failed prompt is NOT remembered in the history", !lastBody.some((c) => c.includes("boom")), "");
    await fetch(`http://127.0.0.1:${ai.port}/api/conversations/fail-aaaaaaaa`, { method: "DELETE" });
  }));

  await guard("I", () => scenario(scripted, {}, async ({ say, ai }) => {
    // The browser goes away while the model is still thinking.
    const controller = new AbortController();
    const hung = fetch(`http://127.0.0.1:${ai.port}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({ prompt: "hang please", conversationId: "gone-aaaaaaaa" }), signal: controller.signal,
    }).then((r) => r.text()).catch(() => "aborted");
    await sleep(500);
    controller.abort();
    await hung;
    await sleep(500);
    const r = await say({ prompt: "show Delhi", conversationId: "gone-aaaaaaaa" }, { timeoutMs: 8000 });
    record("C15 closing the browser mid-request frees the conversation (next request is not stuck on 409)", r.status === 200, `status=${r.status} ${r.text.slice(0, 100)}`);
    await fetch(`http://127.0.0.1:${ai.port}/api/conversations/gone-aaaaaaaa`, { method: "DELETE" });
  }));

  await guard("M", async () => {
    const groq = await startGroq(nextGroq++, scripted);
    let ai;
    try {
      ai = await startAi(nextAi++, MCP_DEAD, groq.port, {});
      let r = await chat(ai.port, { prompt: "show Delhi" });
      record("C16 MCP server down -> 502 with a message that says what to check (not a generic 500)", r.status === 502 && /map server could not be reached/.test(r.json?.error ?? ""), `${r.status} ${r.text.slice(0, 140)}`);
      r = await chat(ai.port, { prompt: "show Delhi", conversationId: "dead-aaaaaaaa" });
      record("C16b same with a conversation id, and no ghost conversation is left", r.status === 502 && (await (await fetch(`http://127.0.0.1:${ai.port}/health`)).json()).activeConversations === 0, `${r.status}`);
    } finally { if (ai) await stop(ai.child); groq.close(); }
  });

  /* ------------------------------------ streaming ----------------------------------- */
  await guard("S", () => scenario(scripted, {}, async ({ say, stream, ai }) => {
    const r = await stream({ prompt: "show Delhi", conversationId: "strm-aaaaaaaa" });
    const types = r.lines.map((l) => l.type);
    const progress = r.lines.filter((l) => l.type === "progress").map((l) => l.text);
    const last = r.lines.at(-1);
    record("S1 stream: 200, ndjson, progress lines first and ONE result line last", r.status === 200 && /ndjson/.test(r.contentType ?? "") && last?.type === "result" && types.filter((t) => t === "result").length === 1 && types.slice(0, -1).every((t) => t === "progress"), `types=${types}`);
    record("S2 progress texts are readable and in order", progress[0] === "Understanding your request…" && progress.includes("Finding Delhi…") && progress.at(-1) === "Drawing the map…", JSON.stringify(progress));
    record("S3 the result line carries scene, message and conversation info", last?.scene?.objects?.length === 2 && typeof last?.message === "string" && last?.conversationId === "strm-aaaaaaaa" && last?.isNewConversation === true, JSON.stringify(Object.keys(last ?? {})));

    const plain = await say({ prompt: "add Mumbai", conversationId: "strm-aaaaaaaa" });
    record("S4 the same conversation continues across stream and non-stream requests", plain.json?.isNewConversation === false && names(plain.json?.scene, "marker").sort().join() === "Delhi,Mumbai");

    const bad = await stream({ prompt: "   " });
    record("S5 an error BEFORE anything was sent is a normal HTTP error (400 JSON), not a stream", bad.status === 400 && /Missing prompt/.test(bad.text), `${bad.status} ${bad.text.slice(0, 80)}`);
    await fetch(`http://127.0.0.1:${ai.port}/api/conversations/strm-aaaaaaaa`, { method: "DELETE" });
  }));

  await guard("S6", () => scenario(scripted, {}, async ({ stream }) => {
    const r = await stream({ prompt: "boom" });
    const last = r.lines.at(-1);
    record("S6 an error AFTER progress started arrives as an error line with status + message",
      r.status === 200 && last?.type === "error" && typeof last.status === "number" && last.status >= 500 && /AI provider/.test(last.error ?? ""), `${r.status} last=${JSON.stringify(last)}`);
  }));

  await stop(mcp); await stop(mcpShort);
  finish();
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(2); });
