import type { ChatLimits } from "./config.js";
import { ChatError, deadlineError } from "./errors.js";
import { describeToolCall, withMapContext } from "./mapContext.js";

/*
 * The tool-calling loop, independent of Groq and of the MCP SDK so it can be
 * tested with fakes. How it behaves:
 *
 *   - every tool call the model makes in a turn is executed, in order;
 *   - the model's renderScene call only means "I am finished": the loop stops
 *     after that turn and the CODE calls renderScene exactly once at the end;
 *   - the reply is the model's own last text, or a summary of what was drawn;
 *   - the loop is bounded by an iteration cap and by the request deadline.
 */

export interface McpToolInfo {
  name: string;
  description?: string | undefined;
  inputSchema?: object | undefined;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string, exactly as the model produced it. */
  arguments: string;
}

export interface LlmReply {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface CallContext {
  signal: AbortSignal;
  deadlineAt: number;
}

export interface Llm {
  complete(
    messages: Array<Record<string, unknown>>,
    tools: McpToolInfo[],
    context: CallContext
  ): Promise<LlmReply>;
}

export interface McpLike {
  listTools(signal: AbortSignal): Promise<McpToolInfo[]>;
  /** Returns the concatenated text blocks of the result. */
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<{ text: string; isError: boolean }>;
}

export interface ChatResult {
  scene: { objects: Array<{ type?: unknown }> } & Record<string, unknown>;
  message: string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RunChatOptions {
  prompt: string;
  /** Earlier turns of this conversation (oldest first), for follow-up prompts. */
  history?: readonly HistoryMessage[];
  /** Summary of what is already on the map (see describeMap); "" or undefined for an empty map. */
  mapSummary?: string | undefined;
  /** Called with short human-readable progress texts. Must not throw. */
  onProgress?: ((text: string) => void) | undefined;
  systemPrompt: string;
  llm: Llm;
  mcp: McpLike;
  limits: ChatLimits;
  context: CallContext;
  log?: (message: string) => void;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? deadlineError();
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function summarizeScene(objects: ReadonlyArray<{ type?: unknown }>): string {
  if (objects.length === 0) return "The map is empty.";
  const counts = new Map<string, number>();
  for (const o of objects) {
    const type = typeof o.type === "string" ? o.type : "object";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const parts = [...counts].map(([type, n]) => plural(n, type));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Rendered ${list}.`;
}

export function validatePrompt(prompt: unknown, limits: ChatLimits): string {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new ChatError(400, "Missing prompt");
  }
  if (prompt.length > limits.maxPromptChars) {
    throw new ChatError(400, `Prompt is too long (${prompt.length} characters; the limit is ${limits.maxPromptChars}).`);
  }
  return prompt;
}

export async function runChat(options: RunChatOptions): Promise<ChatResult> {
  const { systemPrompt, llm, mcp, limits, context } = options;
  const log = options.log ?? (() => undefined);
  const progress = (text: string | null): void => {
    if (text === null) return;
    try {
      options.onProgress?.(text);
    } catch {
      /* progress is best effort */
    }
  };
  const { signal } = context;
  const prompt = validatePrompt(options.prompt, limits);

  const tools = await mcp.listTools(signal);

  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt },
    ...(options.history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: withMapContext(prompt, options.mapSummary ?? "") },
  ];

  let modelText = "";
  let finished = false;
  let turns = 0;

  while (turns < limits.maxToolIterations) {
    throwIfAborted(signal);
    turns++;

    progress(turns === 1 ? "Understanding your request…" : "Planning the next step…");
    const reply = await llm.complete(messages, tools, context);
    const text = reply.content?.trim();
    if (text) modelText = text;

    if (reply.toolCalls.length === 0) {
      finished = true;
      break;
    }

    log(`[AI] Turn ${turns}: ${reply.toolCalls.length} tool call(s)`);

    messages.push({
      role: "assistant",
      content: reply.content ?? "",
      tool_calls: reply.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    let renderRequested = false;

    for (const call of reply.toolCalls) {
      throwIfAborted(signal);

      if (call.name === "renderScene") {
        // Not executed here: the scene is rendered once, below, after ALL
        // other calls of this turn have run.
        renderRequested = true;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "OK. The scene will be rendered automatically when you finish.",
        });
        continue;
      }

      log(`[AI] Calling MCP tool: ${call.name}`);
      let toolText: string;
      try {
        const args = JSON.parse(call.arguments || "{}") as unknown;
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          throw new Error("Tool arguments must be a JSON object.");
        }
        progress(describeToolCall(call.name, args as Record<string, unknown>));
        const result = await mcp.callTool(call.name, args as Record<string, unknown>, signal);
        toolText = result.text;
      } catch (error) {
        throwIfAborted(signal);
        toolText = `Error: ${error instanceof Error ? error.message : String(error)}`;
        log(`[AI] MCP tool failed: ${call.name}: ${toolText}`);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: toolText });
    }

    if (renderRequested) {
      finished = true;
      break;
    }
  }

  throwIfAborted(signal);

  // Single place where the scene is produced, whatever way the loop ended.
  progress("Drawing the map…");
  const rendered = await mcp.callTool("renderScene", {}, signal);
  if (rendered.isError) {
    throw new ChatError(502, `The map server could not render the scene: ${rendered.text}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rendered.text);
  } catch {
    throw new ChatError(502, "The map server returned an unreadable scene.");
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    !Array.isArray((parsed as { objects?: unknown }).objects)
  ) {
    throw new ChatError(502, "The map server returned an invalid scene.");
  }
  const scene = parsed as ChatResult["scene"];

  let message = modelText || summarizeScene(scene.objects);
  if (!finished) {
    log(`[AI] Stopped after ${turns} turn(s) without the model finishing.`);
    message += `\n(Stopped after ${limits.maxToolIterations} steps, so the map may be incomplete.)`;
  }

  return { scene, message };
}
