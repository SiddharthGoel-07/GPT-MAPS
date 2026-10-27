import { test } from "node:test";
import assert from "node:assert/strict";
import { runChat, summarizeScene, validatePrompt } from "../src/chatLoop.ts";
import type { Llm, LlmReply, McpLike, ToolCall } from "../src/chatLoop.ts";
import { ChatError } from "../src/errors.ts";

const limits = { maxPromptChars: 100, maxToolIterations: 5, requestTimeoutMs: 1000 };
let id = 0;
const call = (name: string, args: unknown = {}): ToolCall => ({ id: `c${++id}`, name, arguments: typeof args === "string" ? args : JSON.stringify(args) });
const reply = (content: string | null, ...toolCalls: ToolCall[]): LlmReply => ({ content, toolCalls });

function fakes(replies: LlmReply[], opts: { scene?: unknown; toolText?: (name: string) => string; toolFails?: string[] } = {}) {
  const executed: string[] = [];
  const llmMessages: Array<Array<Record<string, unknown>>> = [];
  const scene = opts.scene ?? { version: 1, objects: [{ type: "marker" }, { type: "label" }] };
  let turn = 0;
  const llm: Llm = {
    async complete(messages) {
      llmMessages.push(structuredClone(messages));
      const r = replies[turn++];
      if (!r) throw new Error("fake LLM ran out of replies");
      return r;
    },
  };
  const mcp: McpLike = {
    async listTools() { return [{ name: "createMarker" }]; },
    async callTool(name) {
      executed.push(name);
      if (opts.toolFails?.includes(name)) throw new Error("tool exploded");
      if (name === "renderScene") return { text: typeof scene === "string" ? scene : JSON.stringify(scene), isError: false };
      return { text: opts.toolText?.(name) ?? `ok ${name}`, isError: false };
    },
  };
  const controller = new AbortController();
  const context = { signal: controller.signal, deadlineAt: Date.now() + 1000 };
  const run = (prompt = "hi", over: Partial<typeof limits> = {}) =>
    runChat({ prompt, systemPrompt: "sys", llm, mcp, limits: { ...limits, ...over }, context });
  return { run, executed, llmMessages, controller, llmTurns: () => turn };
}

test("executes every call in a turn, even after renderScene, and renders once at the end", async () => {
  const f = fakes([reply(null, call("createMarker"), call("renderScene"), call("createLabel"))]);
  await f.run();
  assert.deepEqual(f.executed, ["createMarker", "createLabel", "renderScene"]);
});

test("a model that never calls renderScene still gets a rendered scene", async () => {
  const f = fakes([reply(null, call("createMarker")), reply("done")]);
  const r = await f.run();
  assert.deepEqual(f.executed, ["createMarker", "renderScene"]);
  assert.equal(r.message, "done");
});

test("every tool_call id gets exactly one tool message before the next LLM turn", async () => {
  const c1 = call("createMarker"), c2 = call("createLabel"), c3 = call("createMarker", "{bad json");
  const f = fakes([reply(null, c1, c2, c3), reply("end")]);
  await f.run();
  const second = f.llmMessages[1]!;
  const assistant = second.find((m) => m.role === "assistant") as { tool_calls: Array<{ id: string }> };
  const answered = second.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
  assert.deepEqual(assistant.tool_calls.map((t) => t.id), [c1.id, c2.id, c3.id]);
  assert.deepEqual(answered, [c1.id, c2.id, c3.id]);
});

test("reply is the model's last non-empty text; otherwise a summary of the scene", async () => {
  const a = await fakes([reply("Marking now.", call("createMarker"), call("renderScene"))]).run();
  assert.equal(a.message, "Marking now.");
  const b = await fakes([reply("first", call("createMarker")), reply("   ")]).run();
  assert.equal(b.message, "first", "blank text does not overwrite");
  const c = await fakes([reply(null, call("renderScene"))], { scene: { objects: [{ type: "marker" }, { type: "marker" }, { type: "path" }] } }).run();
  assert.equal(c.message, "Rendered 2 markers and 1 path.");
});

test("bad tool arguments are reported to the model and the loop carries on", async () => {
  const f = fakes([reply(null, call("createMarker", "{not json"), call("createMarker", "[1,2]"), call("createMarker", {})), reply("ok")]);
  const r = await f.run();
  assert.deepEqual(f.executed, ["createMarker", "renderScene"], "only the valid call reached the server");
  const toolMsgs = f.llmMessages[1]!.filter((m) => m.role === "tool").map((m) => String(m.content));
  assert.match(toolMsgs[0]!, /^Error:/);
  assert.match(toolMsgs[1]!, /must be a JSON object/);
  assert.equal(r.message, "ok");
});

test("a tool that throws is reported to the model, not fatal", async () => {
  const f = fakes([reply(null, call("createPath")), reply("sorry")], { toolFails: ["createPath"] });
  const r = await f.run();
  assert.match(String(f.llmMessages[1]!.at(-1)!.content), /tool exploded/);
  assert.equal(r.message, "sorry");
});

test("iteration cap: stops asking the model, still renders, and says it may be incomplete", async () => {
  const endless = Array.from({ length: 10 }, () => reply(null, call("createMarker")));
  const f = fakes(endless);
  const r = await f.run("go", { maxToolIterations: 3 });
  assert.equal(f.llmTurns(), 3);
  assert.equal(f.executed.at(-1), "renderScene");
  assert.match(r.message, /may be incomplete/);
});

test("deadline: aborting stops the loop with the abort reason and never renders", async () => {
  const f = fakes([reply(null, call("createMarker")), reply(null, call("createMarker"))]);
  const reason = new ChatError(504, "too slow");
  f.controller.abort(reason);
  await assert.rejects(f.run(), (e: unknown) => e === reason);
  assert.ok(!f.executed.includes("renderScene"));
});

test("invalid / unreadable / errored scenes from the map server become 502", async () => {
  for (const scene of ["not json", { nope: 1 }, "[1,2]", "null"]) {
    await assert.rejects(fakes([reply("x")], { scene }).run(), (e: unknown) => e instanceof ChatError && e.status === 502);
  }
  const f = fakes([reply("x")]);
  const bad: McpLike = { listTools: async () => [], callTool: async () => ({ text: "scene cap exceeded", isError: true }) };
  await assert.rejects(
    runChat({ prompt: "p", systemPrompt: "s", llm: { complete: async () => reply("x") }, mcp: bad, limits, context: { signal: f.controller.signal, deadlineAt: Date.now() + 1000 } }),
    (e: unknown) => e instanceof ChatError && e.status === 502 && /scene cap exceeded/.test(e.message)
  );
});

test("validatePrompt", () => {
  assert.equal(validatePrompt("hello", limits), "hello");
  for (const bad of [undefined, null, 5, "", "   "]) {
    assert.throws(() => validatePrompt(bad, limits), (e: unknown) => e instanceof ChatError && e.status === 400);
  }
  assert.throws(() => validatePrompt("x".repeat(101), limits), (e: unknown) => e instanceof ChatError && e.status === 400 && /too long/.test(e.message));
  assert.equal(validatePrompt("x".repeat(100), limits).length, 100);
});

test("a too-long prompt never reaches the LLM", async () => {
  const f = fakes([reply("x")]);
  await assert.rejects(f.run("x".repeat(500)), (e: unknown) => e instanceof ChatError && e.status === 400);
  assert.equal(f.llmTurns(), 0);
});

test("summarizeScene wording", () => {
  assert.equal(summarizeScene([]), "The map is empty.");
  assert.equal(summarizeScene([{ type: "marker" }]), "Rendered 1 marker.");
  assert.equal(summarizeScene([{ type: "marker" }, { type: "label" }, { type: "label" }]), "Rendered 1 marker and 2 labels.");
  assert.equal(summarizeScene([{ type: "marker" }, { type: "path" }, { type: "polygon" }]), "Rendered 1 marker, 1 path and 1 polygon.");
});
