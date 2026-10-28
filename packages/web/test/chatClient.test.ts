import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChatRequestError, describeFailure, endConversation, newConversationId, sendChat,
} from "../src/chat/chatClient.ts";

/* A fake fetch whose body arrives in the chunks we choose (to test line splitting). */
function streamResponse(chunks: Array<string | Uint8Array>, status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "application/x-ndjson" } });
}
const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const RESULT = { type: "result", scene: { version: 1, objects: [] }, message: "Done.", conversationId: "abc12345", isNewConversation: true };

function recorder(response: Response | (() => Response | Promise<Response>)) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return typeof response === "function" ? response() : response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/* ---------------------------- describeFailure ---------------------------- */

test("describeFailure: the server's own message wins", () => {
  assert.equal(describeFailure(429, "Too many requests. Please wait 12 seconds and try again."), "Too many requests. Please wait 12 seconds and try again.");
  assert.equal(describeFailure(504, "The request took too long and was cancelled. Try a simpler prompt."), "The request took too long and was cancelled. Try a simpler prompt.");
  assert.match(describeFailure(401, "Missing or wrong access token."), /access token/);
});

test("describeFailure: sensible fallbacks when there is no body (e.g. dev proxy while the server is down)", () => {
  assert.match(describeFailure(null, undefined), /Cannot reach the AI server/);
  assert.match(describeFailure(429, undefined), /Too many requests/);
  assert.match(describeFailure(504, undefined), /too long/);
  assert.match(describeFailure(502, undefined), /not responding/);
  assert.match(describeFailure(500, "  "), /not responding/);
  assert.match(describeFailure(403, undefined), /refused/);
  assert.match(describeFailure(418, undefined), /status 418/);
});

/* -------------------------------- sendChat -------------------------------- */

test("sendChat: progress lines are reported in order, then the result is returned", async () => {
  const progress: string[] = [];
  const { fetchImpl, calls } = recorder(streamResponse([line({ type: "progress", text: "Finding Delhi…" }), line({ type: "progress", text: "Drawing the map…" }), line(RESULT)]));
  const r = await sendChat({ baseUrl: "http://ai", prompt: "show Delhi", conversationId: "abc12345", onProgress: (t) => progress.push(t), fetchImpl });
  assert.deepEqual(progress, ["Finding Delhi…", "Drawing the map…"]);
  assert.equal(r.message, "Done.");
  assert.equal(r.conversationId, "abc12345");
  assert.equal(r.isNewConversation, true);
  assert.equal((r as unknown as { type?: string }).type, undefined, "the event type is not part of the result");
  assert.equal(calls[0]!.url, "http://ai/api/chat");
});

test("sendChat: request asks for the stream and carries prompt, conversation id and token", async () => {
  const { fetchImpl, calls } = recorder(streamResponse([line(RESULT)]));
  await sendChat({ baseUrl: "", prompt: "hi", conversationId: "abc12345", authToken: "tok", fetchImpl });
  const init = calls[0]!.init;
  const headers = init.headers as Record<string, string>;
  assert.equal(calls[0]!.url, "/api/chat");
  assert.equal(init.method, "POST");
  assert.equal(headers.Accept, "application/x-ndjson");
  assert.equal(headers.Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(init.body as string), { prompt: "hi", conversationId: "abc12345" });
});

test("sendChat: without a conversation id or token neither is sent", async () => {
  const { fetchImpl, calls } = recorder(streamResponse([line(RESULT)]));
  await sendChat({ baseUrl: "", prompt: "hi", fetchImpl });
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { prompt: "hi" });
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, undefined);
});

test("sendChat: lines split at arbitrary byte positions (even inside a multi-byte character) still parse", async () => {
  const all = new TextEncoder().encode(line({ type: "progress", text: "Finding Île-de-France…" }) + line(RESULT));
  const chunks = Array.from(all, (b) => new Uint8Array([b])); // one byte per chunk: worst case
  const progress: string[] = [];
  const { fetchImpl } = recorder(streamResponse(chunks));
  const r = await sendChat({ baseUrl: "", prompt: "x", onProgress: (t) => progress.push(t), fetchImpl });
  assert.deepEqual(progress, ["Finding Île-de-France…"]);
  assert.equal(r.message, "Done.");
});

test("sendChat: a final line without a trailing newline is accepted", async () => {
  const { fetchImpl } = recorder(streamResponse([JSON.stringify(RESULT)]));
  assert.equal((await sendChat({ baseUrl: "", prompt: "x", fetchImpl })).message, "Done.");
});

test("sendChat: unknown event types and blank lines are ignored (forward compatible)", async () => {
  const { fetchImpl } = recorder(streamResponse([line({ type: "heartbeat" }), "\n", line({ type: "progress" }), line(RESULT)]));
  assert.equal((await sendChat({ baseUrl: "", prompt: "x", fetchImpl })).message, "Done.");
});

test("sendChat: HTTP error with {error} -> ChatRequestError with the server's message and status", async () => {
  const { fetchImpl } = recorder(() => Response.json({ error: "Too many requests. Please wait 7 seconds and try again." }, { status: 429 }));
  await assert.rejects(sendChat({ baseUrl: "", prompt: "x", fetchImpl }), (e) => {
    assert.ok(e instanceof ChatRequestError);
    assert.equal(e.status, 429);
    assert.equal(e.kind, "http");
    assert.match(e.message, /wait 7 seconds/);
    return true;
  });
});

test("sendChat: HTTP error with an empty / non-JSON body falls back by status", async () => {
  const { fetchImpl } = recorder(() => new Response("<html>Bad gateway</html>", { status: 502 }));
  await assert.rejects(sendChat({ baseUrl: "", prompt: "x", fetchImpl }), /not responding/);
  const empty = recorder(() => new Response(null, { status: 504 }));
  await assert.rejects(sendChat({ baseUrl: "", prompt: "x", fetchImpl: empty.fetchImpl }), /too long/);
});

test("sendChat: network failure -> 'Cannot reach the AI server' (kind network)", async () => {
  const fetchImpl = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
  await assert.rejects(sendChat({ baseUrl: "", prompt: "x", fetchImpl }), (e) => e instanceof ChatRequestError && e.kind === "network" && /Cannot reach/.test(e.message));
});

test("sendChat: an error line in the stream is raised with its status and message", async () => {
  const { fetchImpl } = recorder(streamResponse([line({ type: "progress", text: "Finding…" }), line({ type: "error", status: 503, error: "The AI provider is rate limited right now. Please try again in a moment." })]));
  await assert.rejects(sendChat({ baseUrl: "", prompt: "x", fetchImpl }), (e) => e instanceof ChatRequestError && e.status === 503 && /rate limited/.test(e.message));
});

test("sendChat: a stream that ends without a result is an error, not silence", async () => {
  const { fetchImpl } = recorder(streamResponse([line({ type: "progress", text: "Finding…" })]));
  await assert.rejects(sendChat({ baseUrl: "", prompt: "x", fetchImpl }), /ended the answer without a map/);
});

test("sendChat: unreadable line -> clear error", async () => {
  const { fetchImpl } = recorder(streamResponse(["{not json\n"]));
  await assert.rejects(sendChat({ baseUrl: "", prompt: "x", fetchImpl }), /unreadable answer/);
});

test("sendChat: the connection dropping mid-stream is reported as lost", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(line({ type: "progress", text: "a" }))); c.error(new TypeError("terminated")); },
  });
  const { fetchImpl } = recorder(new Response(body, { status: 200 }));
  await assert.rejects(sendChat({ baseUrl: "", prompt: "x", fetchImpl }), /connection to the AI server was lost/);
});

test("sendChat: an abort requested by the caller is passed through untouched", async () => {
  const controller = new AbortController();
  const fetchImpl = (async (_u: string, init: RequestInit) => { controller.abort(); throw init.signal!.reason; }) as unknown as typeof fetch;
  await assert.rejects(sendChat({ baseUrl: "", prompt: "x", signal: controller.signal, fetchImpl }), (e) => !(e instanceof ChatRequestError));
});

/* ----------------------------- endConversation ----------------------------- */

test("endConversation: DELETE with the encoded id and token", async () => {
  const { fetchImpl, calls } = recorder(new Response(null, { status: 204 }));
  await endConversation({ baseUrl: "http://ai", conversationId: "a/b c", authToken: "tok", fetchImpl });
  assert.equal(calls[0]!.url, "http://ai/api/conversations/a%2Fb%20c");
  assert.equal(calls[0]!.init.method, "DELETE");
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer tok");
});

test("endConversation: never throws, even when the server is down", async () => {
  const fetchImpl = (async () => { throw new TypeError("down"); }) as unknown as typeof fetch;
  await endConversation({ baseUrl: "", conversationId: "abc12345", fetchImpl });
});

/* ----------------------------- newConversationId ---------------------------- */

test("newConversationId: valid for the server's pattern and unique", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newConversationId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
});
