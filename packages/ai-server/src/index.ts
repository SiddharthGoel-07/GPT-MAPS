import "dotenv/config";
import { createServer as createHttpServer } from "node:http";
import Groq from "groq-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const MCP_SERVER_URL = process.env.MCP_SERVER_URL;

if (!MCP_SERVER_URL) {
  console.error("MCP_SERVER_URL environment variable is required.");
  process.exit(1);
}

const MODEL =
  process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

interface ChatRequest {
  prompt: string;
}

interface ChatResponse {
  scene: object;
  message: string;
}

async function createMCPClient() {
  const url = new URL(MCP_SERVER_URL as string);
  const transport = new StreamableHTTPClientTransport(url);

  const client = new Client({
    name: "map-renderer-ai-server",
    version: "1.0.0",
  });

  await client.connect(transport as never);

  return client;
}

function mcpToolToGroqTool(tool: {
  name: string;
  description?: string;
  inputSchema?: object;
}): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? {
        type: "object",
        properties: {},
      },
    },
  };
}

async function handleChat(prompt: string): Promise<ChatResponse> {
  const mcpClient = await createMCPClient();

  try {
    const { tools } = await mcpClient.listTools();

    const groqTools = tools.map((tool) =>
      mcpToolToGroqTool(tool as never)
    );

    const messages: Array<Record<string, unknown>> = [
      {
        role: "system",
        content:
          "You are a map assistant. Use the provided tools to build a map scene.\n" +
          "1. Use createMarker with a 'location' parameter for each place\n" +
          "2. Use createPath with 'start' and 'end' locations to connect markers\n" +
          "3. Use createPolygon with a 'location' to mark boundaries\n" +
          "4. Call renderScene last to finalize the scene\n" +
          "Always use the provided tools and provide valid JSON arguments.",
      },
      {
        role: "user",
        content: prompt,
      },
    ];

    let finalContent = "";
    let serializedScene: object | null = null;

    // Tool-calling loop
    for (let iteration = 0; iteration < 5; iteration++) {
      const response = await groq.chat.completions.create({
        model: MODEL,
        messages: messages as never,
        tools: groqTools as never,
        max_tokens: 4096,
      });

      const message = response.choices[0]?.message;

      if (!message) {
        throw new Error("No response from Groq.");
      }

      const toolCalls = message.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        finalContent = message.content ?? "";
        break;
      }

      // Add assistant tool-call message
      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.function.name,
            arguments: call.function.arguments,
          },
        })),
      });

      // Execute MCP tool calls
      for (const toolCall of toolCalls) {
        let toolResult = "";

        try {
          const args = JSON.parse(
            toolCall.function.arguments || "{}"
          );

          const result = await mcpClient.callTool({
            name: toolCall.function.name,
            arguments: args,
          });

          // Extract the complete text result from MCP.
          const content = (result.content ?? []) as Array<{
            type?: string;
            text?: string;
          }>;

          const fullToolResult = content
            .map((block) => {
              if (block.type === "text" && block.text) {
                return block.text;
              }

              return "";
            })
            .join(" ");

          /*
           * IMPORTANT:
           * Capture renderScene BEFORE truncating the result.
           *
           * The complete scene JSON may be larger than 500 characters.
           * We only truncate the copy sent back to Groq.
           */
          if (toolCall.function.name === "renderScene") {
            try {
              const parsed = JSON.parse(fullToolResult);

              if (
                parsed &&
                typeof parsed === "object" &&
                Array.isArray(parsed.objects)
              ) {
                serializedScene = parsed;
              }
            } catch (error) {
              console.error(
                "Failed to parse renderScene result:",
                error
              );
            }
          }

          // Keep Groq conversation reasonably small.
          toolResult = fullToolResult;

          if (toolResult.length > 500) {
            toolResult =
              toolResult.substring(0, 500) +
              "...[truncated]";
          }
        } catch (error) {
          toolResult = `Error: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`;
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }
    }

    if (!serializedScene) {
      throw new Error(
        "No scene data found. The model may not have called renderScene."
      );
    }

    return {
      scene: serializedScene,
      message: finalContent || "Scene rendered.",
    };
  } finally {
    await mcpClient.close();
  }
}

const httpServer = createHttpServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Chat endpoint
  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const chunks: Buffer[] = [];

      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }

      const body = JSON.parse(
        Buffer.concat(chunks).toString("utf-8")
      ) as ChatRequest;

      if (
        !body.prompt ||
        typeof body.prompt !== "string"
      ) {
        res.writeHead(400, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            error: "Missing prompt",
          })
        );

        return;
      }

      const result = await handleChat(body.prompt);

      res.writeHead(200, {
        "Content-Type": "application/json",
      });

      res.end(JSON.stringify(result));
    } catch (error) {
      console.error("Chat error:", error);

      res.writeHead(500, {
        "Content-Type": "application/json",
      });

      res.end(
        JSON.stringify({
          error: "Failed to process request",
        })
      );
    }

    return;
  }

  res.writeHead(404, {
    "Content-Type": "application/json",
  });

  res.end(
    JSON.stringify({
      error: "Not found",
    })
  );
});

const port = Number(process.env.PORT) || 3002;
const host = "0.0.0.0";

httpServer.listen(port, host, () => {
  console.error(
    `AI Server listening on http://${host}:${port}`
  );
});