import { Aomi } from "@aomi-labs/client";
import { privateKeyToAccount } from "viem/accounts";

const baseUrl = process.env.AOMI_BASE_URL ?? "http://localhost:3000";
const bearer = requiredEnv("AOMI_ACCOUNT_BEARER");
const privateKey = requiredEnv("AOMI_PRIVATE_KEY") as `0x${string}`;
const account = privateKeyToAccount(privateKey);
const paymentChainId = positiveIntegerEnv("AOMI_PAYMENT_CHAIN_ID", 84532);

const aomi = new Aomi({
  baseUrl,
  guest: false,
  getAccountBearer: async () => bearer,
  wallet: {
    evm: {
      address: account.address,
      chainId: paymentChainId,
      signTypedData: async ({ typedData }) =>
        account.signTypedData(typedData as never),
    },
  },
});

const before = await aomi.account.credits.get({ limit: 5 });
console.log({
  period: before.period_utc_month,
  included: before.included,
  bank: before.bank,
  activity: before.entries,
});

const topUpCredits = optionalCredits(process.env.AOMI_TOP_UP_CREDITS);
if (topUpCredits !== undefined) {
  const result = await aomi.account.credits.topUp({
    credits: topUpCredits,
    idempotencyKey: crypto.randomUUID(),
  });
  console.log({ topUp: result });
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalCredits(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const credits = Number(value);
  if (!Number.isFinite(credits)) {
    throw new Error("AOMI_TOP_UP_CREDITS must be a number");
  }
  return credits;
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  const parsed = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive chain id`);
  }
  return parsed;
}
