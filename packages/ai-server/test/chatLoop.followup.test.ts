import { test } from "node:test";
import assert from "node:assert/strict";
import { runChat } from "../src/chatLoop.ts";
import type { Llm, LlmReply, McpLike, ToolCall } from "../src/chatLoop.ts";

const limits = { maxPromptChars: 100, maxToolIterations: 5, requestTimeoutMs: 1000 };
let id = 0;
const call = (name: string, args: unknown = {}): ToolCall => ({ id: `c${++id}`, name, arguments: JSON.stringify(args) });
const reply = (content: string | null, ...toolCalls: ToolCall[]): LlmReply => ({ content, toolCalls });

function run(replies: LlmReply[], extra: Record<string, unknown> = {}) {
  const sent: Array<Array<Record<string, unknown>>> = [];
  let turn = 0;
  const llm: Llm = { async complete(messages) { sent.push(structuredClone(messages)); return replies[turn++]!; } };
  const mcp: McpLike = {
    async listTools() { return []; },
    async callTool(name) { return { text: name === "renderScene" ? JSON.stringify({ version: 1, objects: [] }) : "ok", isError: false }; },
  };
  const controller = new AbortController();
  const promise = runChat({
    prompt: "add Mumbai", systemPrompt: "SYS", llm, mcp, limits,
    context: { signal: controller.signal, deadlineAt: Date.now() + 1000 }, ...extra,
  });
  return { promise, sent };
}

test("messages: system, earlier turns, then the new prompt (unchanged when the map is empty)", async () => {
  const { promise, sent } = run([reply("ok")], {
    history: [{ role: "user", content: "show Delhi" }, { role: "assistant", content: "Done." }],
  });
  await promise;
  const roles = sent[0]!.map((m) => m.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "user"]);
  assert.equal(sent[0]![0]!.content, "SYS");
  assert.equal(sent[0]![1]!.content, "show Delhi");
  assert.equal(sent[0]![3]!.content, "add Mumbai", "no map context for an empty map");
});

test("a non-empty map is described in front of the new request", async () => {
  const { promise, sent } = run([reply("ok")], { mapSummary: 'Markers: "Delhi"' });
  await promise;
  const last = sent[0]!.at(-1)!;
  assert.match(String(last.content), /Markers: "Delhi"/);
  assert.match(String(last.content), /User request: add Mumbai/);
});

test("without history/mapSummary the messages are exactly the old two (system + prompt)", async () => {
  const { promise, sent } = run([reply("ok")]);
  await promise;
  assert.deepEqual(sent[0], [{ role: "system", content: "SYS" }, { role: "user", content: "add Mumbai" }]);
});

test("the prompt length limit is checked on the user's text, not on the map context", async () => {
  const { promise } = run([reply("ok")], { mapSummary: "M".repeat(5000), prompt: "x".repeat(100) });
  await promise; // would throw 400 if the context counted
});

test("progress: understanding, then each tool in order, then drawing", async () => {
  const events: string[] = [];
  const { promise } = run(
    [reply(null, call("createMarker", { location: "Delhi" }), call("createPath", { start: "Delhi", end: "Jaipur" }), call("renderScene")), reply("never")],
    { onProgress: (t: string) => events.push(t) }
  );
  await promise;
  assert.deepEqual(events, ["Understanding your request…", "Finding Delhi…", "Finding a route from Delhi to Jaipur…", "Drawing the map…"]);
});

test("progress: a second LLM turn says 'Planning the next step'", async () => {
  const events: string[] = [];
  const { promise } = run([reply(null, call("createMarker", { location: "Delhi" })), reply("done")], { onProgress: (t: string) => events.push(t) });
  await promise;
  assert.ok(events.includes("Planning the next step…"));
});

test("progress: a callback that throws never breaks the chat", async () => {
  const { promise } = run([reply("fine")], { onProgress: () => { throw new Error("socket closed"); } });
  const r = await promise;
  assert.equal(r.message, "fine");
});

test("progress: bad tool arguments produce no progress line and no crash", async () => {
  const events: string[] = [];
  const bad: ToolCall = { id: "bad1", name: "createMarker", arguments: "{not json" };
  const { promise } = run([reply(null, bad), reply("ok")], { onProgress: (t: string) => events.push(t) });
  await promise;
  assert.ok(!events.some((e) => e.startsWith("Finding")));
});
