/*
 * Talking to the ai-server: sending a prompt (with live progress), turning
 * failures into messages a person can act on, and ending a conversation.
 * No React and no DOM here, so it can be tested with a fake fetch.
 */

export interface ChatResult {
  scene: unknown;
  message: string;
  /** Echoed when the request named a conversation. */
  conversationId?: string;
  /** With conversationId: false when an existing map was continued. */
  isNewConversation?: boolean;
}

export type FailureKind = "network" | "http" | "stream";

export class ChatRequestError extends Error {
  constructor(
    message: string,
    public readonly kind: FailureKind,
    public readonly status: number | null
  ) {
    super(message);
    this.name = "ChatRequestError";
  }
}

/** Text shown to the user. The server's own message wins: it is already written for people. */
export function describeFailure(status: number | null, serverMessage: string | undefined): string {
  const message = serverMessage?.trim();
  if (status === null) {
    return "Cannot reach the AI server. Check that it is running, then try again.";
  }
  if (message) {
    if (status === 401) return `${message} Ask the owner for the access token.`;
    return message;
  }
  switch (status) {
    case 401:
    case 403:
      return "The AI server refused the request (access token or allowed origins).";
    case 429:
      return "Too many requests. Please wait a moment and try again.";
    case 504:
      return "The request took too long and was cancelled. Try a simpler prompt.";
    case 500:
    case 502:
    case 503:
      return "The AI server is not responding properly. Make sure it is running, then try again.";
    default:
      return `The request failed (status ${status}).`;
  }
}

/** Reads {error} from a failed response; tolerates empty or non-JSON bodies. */
async function errorMessageOf(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

export interface SendChatOptions {
  /** "" for the same origin (Vite dev proxy). */
  baseUrl: string;
  prompt: string;
  conversationId?: string | undefined;
  /** Bearer token, if the server requires one. */
  authToken?: string | undefined;
  onProgress?: ((text: string) => void) | undefined;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch;
}

function headers(authToken: string | undefined, extra: Record<string, string>): Record<string, string> {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : extra;
}

/** Applies one line of the server's NDJSON stream. Returns the final result when it is the result line. */
function handleLine(line: string, onProgress: ((text: string) => void) | undefined): ChatResult | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw new ChatRequestError("The AI server sent an unreadable answer.", "stream", null);
  }
  if (event.type === "progress" && typeof event.text === "string") {
    onProgress?.(event.text);
    return null;
  }
  if (event.type === "error") {
    const status = typeof event.status === "number" ? event.status : 500;
    const text = typeof event.error === "string" ? event.error : undefined;
    throw new ChatRequestError(describeFailure(status, text), "http", status);
  }
  if (event.type === "result") {
    const { type: _type, ...rest } = event;
    void _type;
    return rest as unknown as ChatResult;
  }
  return null; // unknown event types are ignored (forward compatible)
}

export async function sendChat(options: SendChatOptions): Promise<ChatResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const body: Record<string, unknown> = { prompt: options.prompt };
  if (options.conversationId) body.conversationId = options.conversationId;

  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl}/api/chat`, {
      method: "POST",
      headers: headers(options.authToken, {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      }),
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ChatRequestError(describeFailure(null, undefined), "network", null);
  }

  if (!response.ok) {
    throw new ChatRequestError(
      describeFailure(response.status, await errorMessageOf(response)),
      "http",
      response.status
    );
  }
  if (!response.body) {
    throw new ChatRequestError("The AI server sent an empty answer.", "stream", null);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ChatResult | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) result = handleLine(line, options.onProgress) ?? result;
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    if (options.signal?.aborted) throw error;
    throw new ChatRequestError("The connection to the AI server was lost.", "stream", null);
  }

  const last = buffer.trim();
  if (last) result = handleLine(last, options.onProgress) ?? result;

  if (!result) {
    throw new ChatRequestError("The AI server ended the answer without a map.", "stream", null);
  }
  return result;
}

/** Ends the server-side map. Best effort: the next prompt starts a new one anyway. */
export async function endConversation(options: {
  baseUrl: string;
  conversationId: string;
  authToken?: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    await doFetch(`${options.baseUrl}/api/conversations/${encodeURIComponent(options.conversationId)}`, {
      method: "DELETE",
      headers: headers(options.authToken, {}),
    });
  } catch {
    /* nothing to do: the server expires idle conversations by itself */
  }
}

/** A fresh conversation id (8-64 characters of [A-Za-z0-9_-]). */
export function newConversationId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
