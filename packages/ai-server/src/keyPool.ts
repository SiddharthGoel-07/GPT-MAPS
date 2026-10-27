import { ChatError } from "./errors.js";

/*
 * Runs an API call against a pool of keys with sensible failure handling:
 *
 *   429 (rate limit)    -> put THAT key on cooldown (Retry-After if given) and use the next key.
 *                          If every key is cooling, wait for the soonest one, but only if
 *                          that fits inside the request deadline.
 *   401 / 403           -> the key is bad: disable it for the life of the process.
 *   5xx / 408 / network -> transient: retry (same key) with exponential backoff + jitter.
 *   other 4xx (400 ...) -> our request is wrong; no key can fix that, so fail immediately.
 *   aborted             -> stop at once (the deadline fired).
 *
 * The Groq SDK must be created with maxRetries: 0, otherwise it retries by itself
 * underneath this logic.
 */

export interface PoolOptions {
  keys: readonly string[];
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  log?: (message: string) => void;
  maxAttempts?: number;
  maxTransientRetries?: number;
  defaultCooldownMs?: number;
  maxCooldownMs?: number;
  backoffBaseMs?: number;
}

export interface RunContext {
  signal: AbortSignal;
  /** Absolute time (same clock as `now`) after which waiting is pointless. */
  deadlineAt: number;
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function headerValue(error: unknown, name: string): string | undefined {
  if (typeof error !== "object" || error === null || !("headers" in error)) return undefined;
  const headers = (error as { headers?: unknown }).headers;
  if (!headers || typeof headers !== "object") return undefined;
  const h = headers as { get?: (n: string) => string | null } & Record<string, unknown>;
  if (typeof h.get === "function") return h.get(name) ?? undefined;
  const raw = h[name];
  return typeof raw === "string" ? raw : undefined;
}

const DURATION_PART = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** How long the provider asks us to wait, in ms, or undefined if it did not say. */
export function retryAfterMs(error: unknown, now: number): number | undefined {
  const rawMs = headerValue(error, "retry-after-ms");
  if (rawMs !== undefined) {
    const ms = Number(rawMs);
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }

  const header = headerValue(error, "retry-after");
  if (header !== undefined) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }

  // Groq puts it in the message: "Please try again in 7.2s" / "in 1m3.4s" / "in 250ms"
  const message = error instanceof Error ? error.message : "";
  const match = /try again in ((?:\d+(?:\.\d+)?(?:ms|s|m|h))+)/i.exec(message);
  if (match?.[1]) {
    let total = 0;
    for (const part of match[1].matchAll(DURATION_PART)) {
      total += Number(part[1]) * (UNIT_MS[part[2] ?? "s"] ?? 1000);
    }
    return total;
  }
  return undefined;
}

export class KeyPool {
  private readonly keys: readonly string[];
  private readonly cooldownUntil: number[];
  private readonly disabled: boolean[];
  private cursor = 0;

  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly log: (message: string) => void;
  private readonly maxAttempts: number;
  private readonly maxTransientRetries: number;
  private readonly defaultCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly backoffBaseMs: number;

  constructor(options: PoolOptions) {
    this.keys = options.keys;
    this.cooldownUntil = options.keys.map(() => 0);
    this.disabled = options.keys.map(() => false);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? abortableSleep;
    this.random = options.random ?? Math.random;
    this.log = options.log ?? (() => undefined);
    this.maxAttempts = options.maxAttempts ?? 8;
    this.maxTransientRetries = options.maxTransientRetries ?? 2;
    this.defaultCooldownMs = options.defaultCooldownMs ?? 5000;
    this.maxCooldownMs = options.maxCooldownMs ?? 60_000;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
  }

  /** Index of the next usable key (starting at the last good one), or -1. */
  private pickKey(now: number): number {
    for (let offset = 0; offset < this.keys.length; offset++) {
      const i = (this.cursor + offset) % this.keys.length;
      if (!this.disabled[i] && (this.cooldownUntil[i] ?? 0) <= now) return i;
    }
    return -1;
  }

  public async run<T>(call: (key: string) => Promise<T>, context: RunContext): Promise<T> {
    const { signal, deadlineAt } = context;
    let transientRetries = 0;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (signal.aborted) throw signal.reason;

      const now = this.now();
      const index = this.pickKey(now);

      if (index === -1) {
        const waiting = this.cooldownUntil.filter((_, i) => !this.disabled[i]);
        if (waiting.length === 0) {
          throw new ChatError(503, "No usable Groq API key is configured.");
        }
        const wait = Math.max(0, Math.min(...waiting) - now);
        if (now + wait >= deadlineAt) {
          throw new ChatError(503, "The AI provider is rate limited right now. Please try again in a moment.");
        }
        this.log(`[AI] All keys rate limited; waiting ${wait}ms`);
        await this.sleep(wait, signal);
        continue;
      }

      const key = this.keys[index] as string;
      try {
        const result = await call(key);
        this.cursor = index;
        return result;
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        const status = statusOf(error);
        const label = `key ${index + 1}/${this.keys.length}`;

        if (status === 429) {
          // Measured from when the error came back, not from before the call.
          const failedAt = this.now();
          const asked = retryAfterMs(error, failedAt) ?? this.defaultCooldownMs;
          const cooldown = Math.min(asked, this.maxCooldownMs);
          this.cooldownUntil[index] = failedAt + cooldown;
          this.log(`[AI] Groq ${label} rate limited; cooling down ${cooldown}ms`);
          continue;
        }

        if (status === 401 || status === 403) {
          this.disabled[index] = true;
          this.log(`[AI] Groq ${label} rejected (HTTP ${status}); disabled`);
          continue;
        }

        const transient = status === undefined || status === 408 || status >= 500;
        if (transient) {
          if (transientRetries >= this.maxTransientRetries) {
            throw new ChatError(502, "The AI provider is unavailable. Please try again.", { cause: error });
          }
          const backoff = Math.round(this.backoffBaseMs * 2 ** transientRetries * (0.5 + this.random() / 2));
          transientRetries++;
          this.log(`[AI] Groq ${label} failed (${status ?? "network"}); retrying in ${backoff}ms`);
          if (now + backoff >= deadlineAt) {
            throw new ChatError(502, "The AI provider is unavailable. Please try again.", { cause: error });
          }
          await this.sleep(backoff, signal);
          continue;
        }

        // 400, 404, 413, 422 ...: retrying or switching keys cannot help.
        throw new ChatError(502, `The AI provider rejected the request (HTTP ${status}).`, { cause: error });
      }
    }

    throw new ChatError(503, "The AI provider could not be reached after several attempts. Please try again.");
  }
}
