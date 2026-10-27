import Groq from "groq-sdk";
import type { CallContext, Llm, McpToolInfo } from "./chatLoop.js";
import type { KeyPool } from "./keyPool.js";

function toGroqTool(tool: McpToolInfo): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  };
}

export interface GroqLlmOptions {
  pool: KeyPool;
  model: string;
  maxTokens?: number;
  baseURL?: string | undefined;
}

export function createGroqLlm(options: GroqLlmOptions): Llm {
  const clients = new Map<string, Groq>();

  const clientFor = (apiKey: string): Groq => {
    let client = clients.get(apiKey);
    if (!client) {
      // maxRetries: 0 -> retries and key rotation are handled by KeyPool only.
      client = new Groq({
        apiKey,
        maxRetries: 0,
        ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      });
      clients.set(apiKey, client);
    }
    return client;
  };

  return {
    async complete(messages, tools, context: CallContext) {
      const response = await options.pool.run(
        (key) =>
          clientFor(key).chat.completions.create(
            {
              model: options.model,
              messages: messages as never,
              tools: tools.map(toGroqTool) as never,
              max_tokens: options.maxTokens ?? 4096,
            },
            { signal: context.signal }
          ),
        context
      );

      const message = response.choices[0]?.message;
      if (!message) throw new Error("No response from Groq.");

      return {
        content: message.content ?? null,
        toolCalls: (message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })),
      };
    },
  };
}
