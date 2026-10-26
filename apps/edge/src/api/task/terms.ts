/**
 * The Task payment terms: the Payment service's public, unauthenticated
 * `/v1/payment/task/terms`. Every venue-facing Task document the edge serves
 * is a pure function of these (plus the API Server's canonical contract), so
 * the backend publishes terms once and never formats them for a venue.
 */
import { z } from "zod";

import type { EdgeEnv } from "../../env";
import { TwoTierCache } from "../../kernel/cache";
import { config } from "../../kernel/config";
import { EdgeError } from "../../kernel/errors";
import type { FetchLike } from "../../kernel/proxy";

// Echoed as published: Payment owns their format.
const address = z.string().min(1);

/** The payable resource: a bare https URL of the build path, as published. */
const resourceUrl = z.string().refine((value) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.href === value && url.protocol === "https:" && !url.port && !url.username && !url.password &&
    !url.search && !url.hash && url.pathname === "/v1/task/build"
  );
});

export const TaskTerms = z.object({
  resource_url: resourceUrl,
  pay_to: address,
  asset: address,
  allow_mainnet: z.boolean(),
});
export type TaskTerms = z.infer<typeof TaskTerms>;

export const ARC_TESTNET = 5042002;
export const ARC_MAINNET = 5042;

/** Testnet always; mainnet only where Payment settles it. */
export function chains(terms: TaskTerms): number[] {
  return terms.allow_mainnet ? [ARC_TESTNET, ARC_MAINNET] : [ARC_TESTNET];
}

/** The chain venue probes and examples use: the paying network when there is one. */
export function exampleChain(terms: TaskTerms): number {
  return terms.allow_mainnet ? ARC_MAINNET : ARC_TESTNET;
}

/**
 * The public, unsigned POST body venue probes send. It reaches the body-bound
 * 402 without exposing a private job or authorising execution.
 */
export function exampleRequest(chainId: number): { intent: string; chainId: number; sender: string } {
  const network = chainId === ARC_MAINNET ? "Arc Mainnet" : chainId === ARC_TESTNET ? "Arc Testnet" : `eip155:${chainId}`;
  return {
    intent: `Simulate a no-op on ${network}. Do not sign or broadcast any transaction.`,
    chainId,
    sender: "0x000000000000000000000000000000000000dEaD",
  };
}

// Terms change only with a Payment deploy; a minute of staleness is harmless.
const TTL_SECONDS = 60;
const cache = new TwoTierCache();

export function resetTermsCache(): void {
  cache.clear();
}

export async function taskTerms(env: EdgeEnv, fetchImpl: FetchLike, now = Date.now()): Promise<TaskTerms> {
  const payment = config(env).payment;
  if (!payment) throw new EdgeError(503, "payment_unavailable");
  const key = `task:terms:v1:${new URL(payment).host}`;
  const cached = await cache.get(key, env.EDGE_CACHE, now);
  if (cached) return TaskTerms.parse(JSON.parse(cached));

  const response = await fetchImpl(new Request(`${payment}/v1/payment/task/terms`, { headers: { accept: "application/json" } }), {
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) throw new EdgeError(503, "payment_unavailable");
  const terms = TaskTerms.safeParse(await response.json().catch(() => null));
  if (!terms.success) throw new EdgeError(502, "invalid_task_terms");
  await cache.put(key, JSON.stringify(terms.data), TTL_SECONDS, env.EDGE_CACHE, now);
  return terms.data;
}
