import "dotenv/config";
import { createServer as createHttpServer } from "node:http";
import Groq from "groq-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/*
 * ---------------------------------------------------------
 * GROQ API KEYS
 * ---------------------------------------------------------
 *
 * Put your legitimate API keys in .env:
 *
 * GROQ_API_KEY_1=...
 * GROQ_API_KEY_2=...
 * GROQ_API_KEY_3=...
 * GROQ_API_KEY_4=...
 * GROQ_API_KEY_5=...
 *
 * The server will try them in order.
 * If a key fails, the next key is tried.
 */

const groqApiKeys = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
].filter((key): key is string => Boolean(key));

if (groqApiKeys.length === 0) {
  console.error("No Groq API keys configured.");
  process.exit(1);
}

console.log(
  `[AI] Loaded ${groqApiKeys.length} Groq API key(s).`
);

function getMcpServerUrl(): string {
  const url = process.env.MCP_SERVER_URL;
  if (!url) {
    throw new Error(
      "MCP_SERVER_URL environment variable is required."
    );
  }
  return url;
}

const MCP_SERVER_URL = getMcpServerUrl();

const MODEL =
  process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

interface ChatRequest {
  prompt: string;
}

interface ChatResponse {
  scene: object;
  message: string;
}

/*
 * ---------------------------------------------------------
 * GROQ REQUEST WITH KEY FALLBACK
 * ---------------------------------------------------------
 */

async function callGroq(
  request: Parameters<
    Groq["chat"]["completions"]["create"]
  >[0] & { stream?: false }
): Promise<Groq.Chat.Completions.ChatCompletion> {
  let lastError: unknown = null;

  for (let i = 0; i < groqApiKeys.length; i++) {
    const key = groqApiKeys[i];

    console.log(
      `[AI] Trying Groq API key ${i + 1}/${groqApiKeys.length}`
    );

    try {
      const groq = new Groq({
        apiKey: key,
      });

      const response =
        await groq.chat.completions.create(request);

      console.log(
        `[AI] Groq API key ${i + 1} succeeded`
      );

      return response;
    } catch (error) {
      lastError = error;

      console.error(
        `[AI] Groq API key ${i + 1} failed:`,
        error instanceof Error
          ? error.message
          : String(error)
      );

      if (i < groqApiKeys.length - 1) {
        console.log(
          `[AI] Falling back to Groq API key ${i + 2}`
        );
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All Groq API keys failed.");
}

/*
 * ---------------------------------------------------------
 * MCP CLIENT
 * ---------------------------------------------------------
 */

async function createMCPClient() {
  const url = new URL(MCP_SERVER_URL);

  const transport =
    new StreamableHTTPClientTransport(url);

  const client = new Client({
    name: "map-renderer-ai-server",
    version: "1.0.0",
  });

  await client.connect(transport as never);

  return client;
}

/*
 * ---------------------------------------------------------
 * MCP TOOL → GROQ TOOL
 * ---------------------------------------------------------
 */

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

/*
 * ---------------------------------------------------------
 * CHAT HANDLER
 * ---------------------------------------------------------
 */

async function handleChat(
  prompt: string
): Promise<ChatResponse> {
  const mcpClient = await createMCPClient();

  try {
    const { tools } =
      await mcpClient.listTools();

    const groqTools = tools.map((tool) =>
      mcpToolToGroqTool(tool as never)
    );

    /*
     * -----------------------------------------------------
     * SYSTEM PROMPT
     * -----------------------------------------------------
     *
     * Keep the map behavior/rules here.
     */

    const messages: Array<Record<string, unknown>> = [
      {
        role: "system",
        content:
          "You are an intelligent map assistant. Use the provided MCP tools to build a clear, attractive, and informative map scene.\n" +

          "\nCORE RULES:\n" +
          "1. Follow the user's request exactly. Do not add unrelated places, routes, boundaries, or map objects.\n" +
          "2. Use the appropriate MCP tool for every geographic feature requested by the user.\n" +
          "3. Whenever you intentionally draw or display a geographic feature, give it one meaningful label using createLabel whenever a suitable label can reasonably be placed.\n" +
          "4. A place represented by createMarker should normally have one label containing that place's actual name.\n" +
          "5. A region represented by createPolygon should normally have one label containing that region's actual name.\n" +
          "6. For a path or route, clearly label its relevant endpoint places. Do not create a meaningless label for the path itself unless the user requests one.\n" +
          "7. Never create duplicate labels for the same geographic feature.\n" +
          "8. Label text must describe the actual geographic feature. Never use placeholder, random, malformed, or meaningless text such as 'label', 'labels', 'labekls', 'text', etc.\n" +
          "9. Keep label text concise and useful. Prefer the actual place or region name unless the user explicitly requests different text.\n" +
          "10. Complete each requested operation ONCE. Before calling a tool, check whether that exact feature has already been created. Never repeat an identical tool call.\n" +

          "\nTOOL RULES:\n" +
          "11. Use createMarker with a 'location' parameter for places that should be represented as point markers.\n" +
          "12. Use createPath with 'start' and 'end' locations when the user requests a connection, route, or path between locations.\n" +
          "13. Use createPolygon with a 'location' when the user requests a region, boundary, area, or territory to be highlighted.\n" +
          "14. Use createLabel with 'location' and 'text' for labels.\n" +
          "15. Complete all required map construction operations before calling renderScene.\n" +
          "16. renderScene must be the final map operation. Once renderScene is called, the scene is finalized and you must not request any more tools.\n" +

          "\nSTYLING RULES:\n" +
          "17. Make the map visually attractive, readable, and professional.\n" +
          "18. Use sensible styling by default even when the user does not explicitly specify styling.\n" +
          "19. Use visually distinct but harmonious styling for markers, paths, polygons, and labels.\n" +
          "20. Prefer subtle, restrained styling over oversized or visually dominant objects.\n" +
          "21. MARKER SIZE: Keep markers small and unobtrusive by default. Do NOT use large marker sizes even if the user explicitly asks for a large/prominent marker.\n" +
          "22. For normal markers, either omit the 'size' option or use a small size. Never use excessively large marker sizes merely to make a location noticeable; use its label and color instead.\n" +
          "23. If several markers are displayed, keep their sizes consistent unless the user explicitly asks to emphasize particular locations.\n" +
          "24. PATH WIDTH: Keep paths reasonably thin and readable. Do not make paths excessively thick unless the user explicitly requests emphasis.\n" +
          "25. POLYGONS: Prefer moderate fill opacity so that the underlying map remains visible. Avoid overly opaque fills that hide map details.\n" +
          "26. LABELS: Keep labels compact and readable. Do not use unnecessarily large font sizes or heavy styling.\n" +
          "27. Use appropriate colors, widths, opacity, and dash styles for the type of geographic feature being displayed.\n" +
          "28. If the user explicitly requests a color, size, width, opacity, dashed/solid path, or other style, always respect the requested style.\n" +
          "29. Keep related objects visually consistent. Avoid excessive or random colors.\n" +
          "30. Labels must remain readable against the map and should use appropriate font size, weight, color, and background styling when supported.\n" +

          "\nIMPORTANT BEHAVIOR:\n" +
          "31. Do not infer unrelated geographic relationships. For example, if the user asks to mark Shamli, do not create a Delhi path or Uttar Pradesh polygon unless requested.\n" +
          "32. Do not create duplicate markers or duplicate labels unnecessarily.\n" +
          "33. If multiple tools are needed, execute all required tools before renderScene.\n" +
          "34. Always provide valid JSON arguments matching the exact tool schemas returned by tools/list.\n" +
          "35. Never output fake tool calls as text. Use the actual provided tools.\n" +
          "36. Prioritize geographic correctness and visual clarity over adding more objects or more styling.\n",
      },
      {
        role: "user",
        content: prompt,
      },
    ];

    let finalContent = "";
    let serializedScene: object | null = null;

    /*
     * -----------------------------------------------------
     * TOOL LOOP
     * -----------------------------------------------------
     *
     * IMPORTANT:
     * 50 is the defensive maximum.
     * There is NO 5-iteration limit.
     */

    const MAX_TOOL_ITERATIONS = 50;
    let iteration = 0;

    while (
      iteration < MAX_TOOL_ITERATIONS
    ) {
      iteration++;

      const response = await callGroq({
        model: MODEL,
        messages: messages as never,
        tools: groqTools as never,
        max_tokens: 4096,
      });

      const message =
        response.choices[0]?.message;

      if (!message) {
        throw new Error(
          "No response from Groq."
        );
      }

      const toolCalls = message.tool_calls;

      /*
       * Model has finished without requesting
       * another tool.
       */

      if (
        !toolCalls ||
        toolCalls.length === 0
      ) {
        finalContent =
          message.content ?? "";

        break;
      }

      console.log(
        `\n[AI] Tool iteration ${iteration}: ${toolCalls.length} tool call(s)`
      );

      /*
       * Preserve assistant tool-call message.
       */

      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: toolCalls.map(
          (call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.function.name,
              arguments:
                call.function.arguments,
            },
          })
        ),
      });

      /*
       * Execute MCP tool calls.
       */

      for (const toolCall of toolCalls) {
        const toolName =
          toolCall.function.name;

        console.log(
          `[AI] Calling MCP tool: ${toolName}`
        );

        console.log(
          `[AI] Arguments: ${toolCall.function.arguments}`
        );

        try {
          const args = JSON.parse(
            toolCall.function.arguments ||
              "{}"
          );

          const result =
            await mcpClient.callTool({
              name: toolName,
              arguments: args,
            });

          /*
           * Extract complete MCP result.
           */

          const content =
            (result.content ?? []) as Array<{
              type?: string;
              text?: string;
            }>;

          const fullToolResult =
            content
              .map((block) => {
                if (
                  block.type === "text" &&
                  block.text
                ) {
                  return block.text;
                }

                return "";
              })
              .join(" ");

          console.log(
            `[AI] MCP tool completed: ${toolName}`
          );

          /*
           * -------------------------------------------------
           * renderScene IS TERMINAL
           * -------------------------------------------------
           *
           * Capture the complete scene locally.
           *
           * DO NOT send the complete scene JSON
           * back to Groq.
           */

          if (
            toolName ===
            "renderScene"
          ) {
            try {
              const parsed =
                JSON.parse(
                  fullToolResult
                );

              if (
                parsed &&
                typeof parsed ===
                  "object" &&
                Array.isArray(
                  parsed.objects
                )
              ) {
                serializedScene =
                  parsed;

                console.log(
                  `[AI] Scene captured successfully: ${parsed.objects.length} object(s)`
                );

                /*
                 * renderScene is final.
                 * Do not make another Groq request.
                 */

                const scene = serializedScene;

                if (!scene) {
                  throw new Error(
                    "Scene was not captured."
                  );
                }

                return {
                  scene,
                  message:
                    finalContent ||
                    "Scene rendered.",
                };
              }

              throw new Error(
                "renderScene returned an invalid scene structure."
              );
            } catch (error) {
              console.error(
                "[AI] Failed to parse renderScene result:",
                error
              );

              throw new Error(
                "Failed to parse the scene returned by renderScene."
              );
            }
          }

          /*
           * Normal tool results are sent back
           * to Groq so the model can decide what
           * to do next.
           *
           * There is no arbitrary 500-character
           * truncation here.
           */

          messages.push({
            role: "tool",
            tool_call_id:
              toolCall.id,
            content:
              fullToolResult,
          });
        } catch (error) {
          const errorMessage =
            `Error: ${
              error instanceof Error
                ? error.message
                : String(error)
            }`;

          console.error(
            `[AI] MCP tool failed: ${toolName}`,
            error
          );

          /*
           * Tell Groq about the tool failure
           * so it can potentially recover.
           */

          messages.push({
            role: "tool",
            tool_call_id:
              toolCall.id,
            content:
              errorMessage,
          });
        }
      }
    }

    /*
     * -----------------------------------------------------
     * DEFENSIVE RENDER FALLBACK
     * -----------------------------------------------------
     *
     * If the model stops without calling renderScene,
     * finalize the current MCP scene ourselves.
     */

    if (!serializedScene) {
      console.log(
        "[AI] Model finished without renderScene. Calling renderScene explicitly."
      );

      const result =
        await mcpClient.callTool({
          name: "renderScene",
          arguments: {},
        });

      const content =
        (result.content ?? []) as Array<{
          type?: string;
          text?: string;
        }>;

      const renderResult =
        content
          .map((block) => {
            if (
              block.type === "text" &&
              block.text
            ) {
              return block.text;
            }

            return "";
          })
          .join(" ");

      try {
        const parsed =
          JSON.parse(renderResult);

        if (
          parsed &&
          typeof parsed ===
            "object" &&
          Array.isArray(
            parsed.objects
          )
        ) {
          serializedScene =
            parsed;

          console.log(
            `[AI] Explicit renderScene succeeded: ${parsed.objects.length} object(s)`
          );
        }
      } catch (error) {
        console.error(
          "[AI] Failed to parse explicit renderScene result:",
          error
        );
      }
    }

    /*
     * -----------------------------------------------------
     * FINAL VALIDATION
     * -----------------------------------------------------
     */

    if (!serializedScene) {
      if (
        iteration >=
        MAX_TOOL_ITERATIONS
      ) {
        throw new Error(
          `Tool-calling loop reached the defensive limit of ${MAX_TOOL_ITERATIONS} iterations without producing a scene.`
        );
      }

      throw new Error(
        "No scene data found. The MCP scene could not be finalized."
      );
    }

    const scene = serializedScene;

    return {
      scene,
      message:
        finalContent ||
        "Scene rendered.",
    };
  } finally {
    await mcpClient.close();
  }
}

/*
 * ---------------------------------------------------------
 * HTTP SERVER
 * ---------------------------------------------------------
 */

const httpServer =
  createHttpServer(
    async (req, res) => {
      /*
       * CORS
       */

      res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
      );

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
      );

      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
      );

      if (
        req.method === "OPTIONS"
      ) {
        res.writeHead(204);
        res.end();
        return;
      }

      /*
       * Health check
       */

      if (
        req.method === "GET" &&
        req.url === "/health"
      ) {
        res.writeHead(200, {
          "Content-Type":
            "application/json",
        });

        res.end(
          JSON.stringify({
            status: "ok",
          })
        );

        return;
      }

      /*
       * Chat endpoint
       */

      if (
        req.method === "POST" &&
        req.url === "/api/chat"
      ) {
        try {
          const chunks: Buffer[] = [];

          for await (
            const chunk of req
          ) {
            chunks.push(
              chunk as Buffer
            );
          }

          const body =
            JSON.parse(
              Buffer.concat(
                chunks
              ).toString("utf-8")
            ) as ChatRequest;

          if (
            !body.prompt ||
            typeof body.prompt !==
              "string"
          ) {
            res.writeHead(400, {
              "Content-Type":
                "application/json",
            });

            res.end(
              JSON.stringify({
                error:
                  "Missing prompt",
              })
            );

            return;
          }

          const result =
            await handleChat(
              body.prompt
            );

          res.writeHead(200, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify(result)
          );
        } catch (error) {
          console.error(
            "Chat error:",
            error
          );

          res.writeHead(500, {
            "Content-Type":
              "application/json",
          });

          res.end(
            JSON.stringify({
              error:
                "Failed to process request",
            })
          );
        }

        return;
      }

      /*
       * Unknown route
       */

      res.writeHead(404, {
        "Content-Type":
          "application/json",
      });

      res.end(
        JSON.stringify({
          error: "Not found",
        })
      );
    }
  );

const port =
  Number(process.env.PORT) || 3002;

const host = "0.0.0.0";

httpServer.listen(
  port,
  host,
  () => {
    console.error(
      `AI Server listening on http://${host}:${port}`
    );
  }
);