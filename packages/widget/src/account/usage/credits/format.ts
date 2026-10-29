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

export function formatUsd(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}
