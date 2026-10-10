import "@tanstack/react-start/server-only";

type CacheEntry<T> = {
  createdAt: number;
  value: Promise<T>;
};

export class TimedPromiseCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(keyParts: readonly unknown[], load: () => Promise<T>): Promise<T> {
    const key = JSON.stringify(keyParts);
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.createdAt < this.ttlMs) {
      return hit.value;
    }

    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }

    const value = load();
    this.entries.set(key, { createdAt: Date.now(), value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) {
        this.entries.delete(key);
      }
    });
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
