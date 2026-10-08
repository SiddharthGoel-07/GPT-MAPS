/*
 * Shared plumbing for calls to the public Nominatim service:
 *  - RateLimiter: serialises calls and keeps a minimum gap between them
 *    (Nominatim's usage policy allows about 1 request per second).
 *  - PromiseCache: remembers successful lookups (and de-duplicates concurrent
 *    identical ones). Failures are never cached.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private nextAllowed = 0;

  constructor(private readonly minIntervalMs: number) {}

  public run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const wait = this.nextAllowed - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextAllowed = Date.now() + this.minIntervalMs;
      return task();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export class PromiseCache<T> {
  private readonly entries = new Map<string, Promise<T>>();

  constructor(private readonly maxEntries = 500) {}

  public get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit) return hit;

    const promise = load();
    this.entries.set(key, promise);
    promise.catch(() => {
      // never keep a failed lookup
      if (this.entries.get(key) === promise) this.entries.delete(key);
    });

    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return promise;
  }
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

const minInterval = Number(process.env.NOMINATIM_MIN_INTERVAL_MS);

/** One limiter for every Nominatim call in the process (geocoding + boundaries). */
export const nominatimLimiter = new RateLimiter(
  Number.isFinite(minInterval) && minInterval >= 0 ? minInterval : 1100
);

export const REQUEST_TIMEOUT_MS = 10_000;
