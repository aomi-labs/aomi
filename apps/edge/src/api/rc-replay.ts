/**
 * Atomic once-only claim of OIDC `jti` values. A Durable Object serializes its
 * requests, so two concurrent exchanges of one token cannot both succeed (Workers
 * KV is eventually consistent and cannot give that).
 */
import type { ReplayStore } from "../env";

type Storage = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  list(options?: { prefix?: string }): Promise<Map<string, unknown>>;
  delete(keys: string[]): Promise<unknown>;
};

export class RcReplayStore {
  constructor(private readonly state: { storage: Storage }) {}

  /** POST {jti, expiresAt(ms)}: 204 when claimed now, 409 when already seen. */
  async fetch(request: Request): Promise<Response> {
    const { jti, expiresAt } = (await request.json()) as { jti: string; expiresAt: number };
    const now = Date.now();
    const { storage } = this.state;
    const seen = (await storage.get(`jti:${jti}`)) as number | undefined;
    if (seen !== undefined && seen > now) return new Response(null, { status: 409 });
    const expired = [...(await storage.list({ prefix: "jti:" })).entries()]
      .filter(([, until]) => (until as number) <= now)
      .map(([key]) => key);
    if (expired.length) await storage.delete(expired);
    await storage.put(`jti:${jti}`, expiresAt);
    return new Response(null, { status: 204 });
  }
}

/** Claim `jti` until `expiresAt` (ms); false when it was already claimed. */
export async function claimJti(store: ReplayStore, jti: string, expiresAt: number): Promise<boolean> {
  const stub = store.get(store.idFromName("rc-oidc"));
  const response = await stub.fetch(
    new Request("https://replay.invalid/claim", { method: "POST", body: JSON.stringify({ jti, expiresAt }) }),
  );
  if (response.status === 204) return true;
  if (response.status === 409) return false;
  throw new Error(`replay store answered ${response.status}`);
}
