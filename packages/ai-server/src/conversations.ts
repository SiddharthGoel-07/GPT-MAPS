import type { HistoryMessage, McpLike } from "./chatLoop.js";
import { ChatError } from "./errors.js";

/*
 * One conversation = one map = one MCP session that stays open between
 * prompts, plus a short memory of the earlier prompts. The client names a
 * conversation with an id of its own choosing; an unknown id simply starts a
 * new one. Requests without an id are one-shot (the old behaviour): their MCP
 * session is closed as soon as the request ends.
 *
 * Rules: one request at a time per conversation (409 otherwise); idle ones
 * are closed after a TTL; at the cap the least recently used idle one is
 * evicted (503 if every one is busy).
 */

export interface McpConnectionLike {
  mcp: McpLike;
  close(): Promise<void>;
}

export interface Lease {
  /** The conversation id, or undefined for a one-shot request. */
  readonly id: string | undefined;
  readonly mcp: McpLike;
  /** Earlier turns, oldest first. Empty for new and one-shot conversations. */
  readonly history: readonly HistoryMessage[];
  /** True when an existing, still-working conversation was continued. */
  readonly resumed: boolean;
  /** Remember a finished turn (no-op for one-shot requests). */
  commit(userPrompt: string, assistantMessage: string): void;
  /** Always call, success or failure. */
  release(): Promise<void>;
}

export interface ConversationStoreOptions {
  connect: (signal: AbortSignal) => Promise<McpConnectionLike>;
  ttlMs: number;
  maxConversations: number;
  now?: () => number;
  log?: (message: string) => void;
}

interface Entry {
  connection: McpConnectionLike | undefined;
  history: HistoryMessage[];
  busy: boolean;
  lastUsed: number;
}

export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_HISTORY_MESSAGES = 12; // 6 turns
const MAX_HISTORY_CHARS = 600;

const clip = (text: string): string =>
  text.length > MAX_HISTORY_CHARS ? `${text.slice(0, MAX_HISTORY_CHARS - 1)}…` : text;

export class ConversationStore {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: ConversationStoreOptions) {
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
  }

  public get size(): number {
    return this.entries.size;
  }

  public async acquire(id: string | undefined, signal: AbortSignal): Promise<Lease> {
    if (id === undefined) return this.acquireOneShot(signal);
    if (!CONVERSATION_ID_PATTERN.test(id)) {
      throw new ChatError(400, "Invalid conversationId (use 8-64 letters, digits, - or _).");
    }

    const existing = this.entries.get(id);
    if (existing) {
      if (existing.busy) {
        throw new ChatError(409, "Your previous request on this map is still running. Please wait for it to finish.");
      }
      existing.busy = true;
      try {
        return await this.resume(id, existing, signal);
      } catch (error) {
        existing.busy = false;
        throw error;
      }
    }
    return this.create(id, signal);
  }

  /** Closes one conversation. Returns false if there was none. */
  public async remove(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (entry.busy) throw new ChatError(409, "This map is busy right now. Try again in a moment.");
    this.entries.delete(id);
    await entry.connection?.close();
    this.log(`[conv] closed ${id} (new map); active=${this.entries.size}`);
    return true;
  }

  public async sweep(): Promise<void> {
    const now = this.now();
    const expired = [...this.entries].filter(([, e]) => !e.busy && now - e.lastUsed > this.options.ttlMs);
    for (const [id, entry] of expired) {
      this.entries.delete(id);
      await entry.connection?.close();
      this.log(`[conv] closed ${id} (idle); active=${this.entries.size}`);
    }
  }

  public start(sweepMs: number): void {
    this.timer = setInterval(() => void this.sweep(), sweepMs);
    this.timer.unref();
  }

  public async closeAll(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(all.map((e) => e.connection?.close()));
  }

  /* ------------------------------- internals ------------------------------- */

  private async acquireOneShot(signal: AbortSignal): Promise<Lease> {
    const connection = await this.options.connect(signal);
    return {
      id: undefined,
      mcp: connection.mcp,
      history: [],
      resumed: false,
      commit: () => undefined,
      release: () => connection.close(),
    };
  }

  private async create(id: string, signal: AbortSignal): Promise<Lease> {
    // Reserve the id first (synchronously): a parallel request with the same id gets a 409
    // and the cap below counts this entry.
    const entry: Entry = { connection: undefined, history: [], busy: true, lastUsed: this.now() };
    this.entries.set(id, entry);
    try {
      await this.makeRoom(id);
      entry.connection = await this.options.connect(signal);
    } catch (error) {
      this.entries.delete(id);
      throw error;
    }
    this.log(`[conv] opened ${id}; active=${this.entries.size}`);
    return this.lease(id, entry, false);
  }

  private async resume(id: string, entry: Entry, signal: AbortSignal): Promise<Lease> {
    const connection = entry.connection;
    if (connection) {
      try {
        // Cheap round-trip that proves the MCP session still exists on the server.
        await connection.mcp.listTools(signal);
        return this.lease(id, entry, true);
      } catch (error) {
        if (signal.aborted) throw error;
        this.log(`[conv] ${id}: MCP session lost (${error instanceof Error ? error.message : String(error)}); starting a new map`);
        await connection.close();
        entry.connection = undefined;
        entry.history = [];
      }
    }
    entry.connection = await this.options.connect(signal);
    return this.lease(id, entry, false);
  }

  private lease(id: string, entry: Entry, resumed: boolean): Lease {
    const connection = entry.connection as McpConnectionLike;
    return {
      id,
      mcp: connection.mcp,
      history: [...entry.history],
      resumed,
      commit: (userPrompt, assistantMessage) => {
        entry.history.push({ role: "user", content: clip(userPrompt) });
        entry.history.push({ role: "assistant", content: clip(assistantMessage) });
        if (entry.history.length > MAX_HISTORY_MESSAGES) {
          entry.history.splice(0, entry.history.length - MAX_HISTORY_MESSAGES);
        }
      },
      release: async () => {
        entry.busy = false;
        entry.lastUsed = this.now();
      },
    };
  }

  private async makeRoom(newId: string): Promise<void> {
    if (this.entries.size <= this.options.maxConversations) return;
    let oldest: [string, Entry] | undefined;
    for (const item of this.entries) {
      if (item[1].busy || item[0] === newId) continue;
      if (!oldest || item[1].lastUsed < oldest[1].lastUsed) oldest = item;
    }
    if (!oldest) {
      throw new ChatError(503, "Too many maps are in use right now. Please try again in a moment.");
    }
    this.entries.delete(oldest[0]);
    await oldest[1].connection?.close();
    this.log(`[conv] closed ${oldest[0]} (evicted at cap); active=${this.entries.size}`);
  }
}
