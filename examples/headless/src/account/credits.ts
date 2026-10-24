import { Aomi } from "@aomi-labs/client";
import { privateKeyToAccount } from "viem/accounts";

const baseUrl = process.env.AOMI_BASE_URL ?? "http://localhost:3000";
const bearer = requiredEnv("AOMI_ACCOUNT_BEARER");
const privateKey = requiredEnv("AOMI_PRIVATE_KEY") as `0x${string}`;
const account = privateKeyToAccount(privateKey);
const paymentChainId = positiveIntegerEnv("AOMI_PAYMENT_CHAIN_ID");

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
  balanceMicrousd: before.balance_microusd,
  activity: before.entries,
});

const credits = optionalCredits(process.env.AOMI_FUNDING_CREDITS);
if (credits !== undefined) {
  const result = await aomi.account.credits.beginFunding({
    amountMicrousd: credits * 10_000,
    method: "wallet",
    chain: `eip155:${paymentChainId}`,
    idempotencyKey: requiredEnv("AOMI_FUNDING_KEY"),
  });
  console.log({ id: result.funding_event.id, status: result.funding_event.status });
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalCredits(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const credits = Number(value);
  if (!Number.isSafeInteger(credits) || credits < 100 || credits > 100_000) {
    throw new Error("AOMI_FUNDING_CREDITS must be a whole number from 100 to 100000");
  }
  return credits;
}

function positiveIntegerEnv(name: string): number {
  const parsed = Number(requiredEnv(name));
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive chain id`);
  }
  return parsed;
}
