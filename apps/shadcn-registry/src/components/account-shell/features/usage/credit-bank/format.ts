export const MIN_TOP_UP_MICROUSD = 10_000;
export const MAX_TOP_UP_MICROUSD = 1_000_000_000;

export function toCredits(microusd: number): number {
  return microusd / 10_000;
}

export function formatCredits(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function formatCreditAmount(value: number): string {
  return `${formatCredits(value)} ${value === 1 ? "credit" : "credits"}`;
}

export function formatUsdc(value: number): string {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} USDC`;
}

export function truncateHex(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
