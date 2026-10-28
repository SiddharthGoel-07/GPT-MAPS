import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";
import { ChatError } from "./errors.js";

/* ------------------------------- CORS + origin ------------------------------- */

/**
 * Sets the CORS headers for an allowed browser origin. A request WITHOUT an
 * Origin header (curl, servers) is not a browser cross-site call and is fine.
 * Returns a rejection for an Origin that is not on the list.
 */
export function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServerConfig
): ChatError | null {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  if (origin === undefined) return null;

  const allowAny = config.allowedOrigins.includes("*");
  if (!allowAny && !config.allowedOrigins.includes(origin)) {
    return new ChatError(403, `Origin ${origin} is not allowed. Add it to ALLOWED_ORIGINS.`);
  }
  res.setHeader("Access-Control-Allow-Origin", allowAny ? "*" : origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
  return null;
}

/* ---------------------------------- token ---------------------------------- */

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

export function tokenMatches(header: string | undefined, expected: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!match || match[1] === undefined) return false;
  return timingSafeEqual(digest(match[1].trim()), digest(expected));
}

export function checkToken(req: IncomingMessage, config: ServerConfig): ChatError | null {
  if (config.authToken === undefined) return null;
  return tokenMatches(req.headers.authorization, config.authToken)
    ? null
    : new ChatError(401, "Missing or wrong access token.");
}

/* -------------------------------- rate limit -------------------------------- */

/**
 * Sliding one-minute window per client key. Memory is bounded: keys whose
 * window is empty are dropped on the sweep, and `maxKeys` caps the table.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now
  ) {}

  /** null = allowed. Otherwise the number of seconds to wait. */
  public check(key: string): number | null {
    if (this.limit <= 0) return null;
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);

    const oldest = recent[0];
    if (recent.length >= this.limit && oldest !== undefined) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
    }

    recent.push(now);
    this.hits.delete(key); // re-insert so the Map keeps recently used keys last
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
    return null;
  }

  public sweep(): void {
    const now = this.now();
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }

  public get size(): number {
    return this.hits.size;
  }
}

/* --------------------------------- body size --------------------------------- */

/** Reads the body but gives up (413) as soon as it grows past the limit. */
export function readBodyLimited(req: IncomingMessage, limit: number): Promise<Buffer> {
  const tooLarge = (): ChatError =>
    new ChatError(413, `Request is too large (the limit is ${limit} bytes).`);

  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      reject(tooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (action: () => void): void => {
      if (done) return;
      done = true;
      req.off("data", onData);
      action();
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) finish(() => reject(tooLarge()));
      else chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => finish(() => resolve(Buffer.concat(chunks))));
    req.on("error", (error) => finish(() => reject(error)));
  });
}
