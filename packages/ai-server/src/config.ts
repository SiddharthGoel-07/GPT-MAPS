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
