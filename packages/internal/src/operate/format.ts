// Operate wire helpers shared by the Build UI, its BFF and the edge Worker.

/** Partner pricing is quoted in credits; 100 credits settle $1.00. */
export const CREDITS_PER_USD = 100;

export function creditsToUsd(credits: unknown): number {
  return Number(credits ?? 0) / CREDITS_PER_USD;
}

export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
  84532: "Base Sepolia",
  11155111: "Sepolia",
};

/** "eip155:8453" → 8453. Anything unparseable → 0. */
export function caipChainId(chain: unknown): number {
  const id = Number(String(chain ?? "").split(":")[1]);
  return Number.isSafeInteger(id) ? id : 0;
}

/** "eip155:8453" → "Base". Unrecognized chains pass through unchanged. */
export function caipChainLabel(chain: unknown): string {
  const raw = String(chain ?? "");
  if (!raw.startsWith("eip155:")) return raw;
  return CHAIN_NAMES[caipChainId(raw)] ?? raw;
}
