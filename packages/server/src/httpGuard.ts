import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/*
 * Network safety for the MCP server (all configurable by environment):
 *   HOST               interface to listen on (default 127.0.0.1 = this machine only)
 *   ALLOWED_ORIGINS    comma-separated browser origins allowed to call /mcp
 *                      (default: none; "*" allows any). Normal MCP clients send
 *                      no Origin header at all and are not affected.
 *   MCP_AUTH_TOKEN     if set, /mcp requires "Authorization: Bearer <token>"
 *   MAX_BODY_BYTES     largest accepted request body (default 1 MB)
 */

export interface GuardConfig {
  host: string;
  allowedOrigins: readonly string[];
  authToken: string | undefined;
  maxBodyBytes: number;
}

export function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isInteger(n) && n > 0 ? n : fallback;
}

export function readGuardConfig(env: NodeJS.ProcessEnv = process.env): GuardConfig {
  const token = env.MCP_AUTH_TOKEN?.trim();
  return {
    host: env.HOST?.trim() || "127.0.0.1",
    allowedOrigins: parseList(env.ALLOWED_ORIGINS),
    authToken: token ? token : undefined,
    maxBodyBytes: positiveInt(env.MAX_BODY_BYTES, 1024 * 1024),
  };
}

export interface Rejection {
  status: number;
  message: string;
}

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

export function tokenMatches(header: string | undefined, expected: string): boolean {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!match || match[1] === undefined) return false;
  // Compare fixed-length digests so neither length nor content leaks through timing.
  return timingSafeEqual(digest(match[1].trim()), digest(expected));
}

/** null = the request may proceed. */
export function checkRequest(req: IncomingMessage, config: GuardConfig): Rejection | null {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const allowed = config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
    if (!allowed) {
      return { status: 403, message: `Origin ${origin} is not allowed. Add it to ALLOWED_ORIGINS.` };
    }
  }
  if (config.authToken !== undefined && !tokenMatches(req.headers.authorization, config.authToken)) {
    return { status: 401, message: "Missing or wrong bearer token." };
  }
  return null;
}

export class BodyTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`Request body is larger than ${limit} bytes.`);
    this.name = "BodyTooLargeError";
  }
}

/** Reads the body, but gives up as soon as it grows past the limit. */
export function readBodyLimited(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new BodyTooLargeError(limit));
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
      if (size > limit) finish(() => reject(new BodyTooLargeError(limit)));
      else chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => finish(() => resolve(Buffer.concat(chunks))));
    req.on("error", (error) => finish(() => reject(error)));
  });
}
