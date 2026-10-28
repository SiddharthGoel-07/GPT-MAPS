export interface ChatLimits {
  /** Longest accepted user prompt, in characters. */
  maxPromptChars: number;
  /** Most LLM round-trips per request. */
  maxToolIterations: number;
  /** Hard wall-clock limit for the whole request. */
  requestTimeoutMs: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function readLimits(env: NodeJS.ProcessEnv = process.env): ChatLimits {
  return {
    maxPromptChars: positiveInt(env.MAX_PROMPT_CHARS, 1000),
    maxToolIterations: positiveInt(env.MAX_TOOL_ITERATIONS, 10),
    requestTimeoutMs: positiveInt(env.REQUEST_TIMEOUT_MS, 60_000),
  };
}

export interface ServerConfig {
  /** Interface to listen on. 127.0.0.1 = this machine only. */
  host: string;
  /** Browser origins allowed to call the API. "*" allows any. */
  allowedOrigins: readonly string[];
  /** Largest accepted request body, in bytes. */
  maxBodyBytes: number;
  /** Chat requests allowed per client IP per minute. 0 = no limit. */
  rateLimitPerMinute: number;
  /** If set, /api/* requires "Authorization: Bearer <token>". */
  authToken: string | undefined;
  /** Token sent to the MCP server (its MCP_AUTH_TOKEN), if it requires one. */
  mcpAuthToken: string | undefined;
}

export const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
] as const;

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const origins = list(env.ALLOWED_ORIGINS);
  const token = env.AUTH_TOKEN?.trim();
  const mcpToken = env.MCP_AUTH_TOKEN?.trim();
  return {
    host: env.HOST?.trim() || "127.0.0.1",
    allowedOrigins: origins.length > 0 ? origins : [...DEFAULT_ALLOWED_ORIGINS],
    maxBodyBytes: positiveInt(env.MAX_BODY_BYTES, 16 * 1024),
    rateLimitPerMinute: nonNegativeInt(env.RATE_LIMIT_PER_MINUTE, 20),
    authToken: token ? token : undefined,
    mcpAuthToken: mcpToken ? mcpToken : undefined,
  };
}

export interface ConversationConfig {
  /** A conversation (map) that is idle this long is closed. Keep below the MCP server's SESSION_TTL_MS. */
  ttlMs: number;
  sweepMs: number;
  maxConversations: number;
}

export function readConversationConfig(env: NodeJS.ProcessEnv = process.env): ConversationConfig {
  return {
    ttlMs: positiveInt(env.CONVERSATION_TTL_MS, 8 * 60_000),
    sweepMs: positiveInt(env.CONVERSATION_SWEEP_MS, 30_000),
    maxConversations: positiveInt(env.MAX_CONVERSATIONS, 50),
  };
}
