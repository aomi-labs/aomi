import type { EdgeCache } from "../env";

/**
 * A short-lived string cache in two tiers: this isolate's memory, then the
 * EDGE_CACHE KV namespace when it is bound. KV keeps an entry at least 60
 * seconds, so callers that need a tighter bound re-check what they read.
 */
export class TwoTierCache {
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string, kv: EdgeCache | undefined, now = Date.now()): Promise<string | null> {
    const hit = this.memory.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    const stored = await kv?.get(key).catch(() => null);
    return stored ?? null;
  }

  async put(key: string, value: string, ttlSeconds: number, kv: EdgeCache | undefined, now = Date.now()): Promise<void> {
    this.memory.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
    await kv?.put(key, value, { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) }).catch(() => undefined);
  }

  async delete(key: string, kv: EdgeCache | undefined): Promise<void> {
    this.memory.delete(key);
    await kv?.delete(key).catch(() => undefined);
  }

  clear(): void {
    this.memory.clear();
  }
}
