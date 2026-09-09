export type KnownToken = { symbol: string; decimals: number };

const KNOWN_TOKENS: Readonly<Record<string, KnownToken>> = {
  // Base's canonical native USDC contract, also used by the repository's
  // wallet-impact metadata fixture and chain integrations.
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
    symbol: "USDC",
    decimals: 6,
  },
};

export const knownToken = (
  chainId: unknown,
  address: unknown,
): KnownToken | undefined =>
  (typeof chainId === "number" || typeof chainId === "string") &&
  typeof address === "string"
    ? KNOWN_TOKENS[`${chainId}:${address.toLowerCase()}`]
    : undefined;

export const formatTokenUnits = (raw: string, decimals: number): string => {
  const value = BigInt(raw);
  if (decimals === 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};
