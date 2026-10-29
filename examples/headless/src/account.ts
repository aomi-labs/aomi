import { Aomi, wallet } from "@aomi-labs/client";
import { privateKeyToAccount } from "viem/accounts";

const baseUrl = process.env.AOMI_BASE_URL || "https://chat.aomi.dev";
if (!process.env.AOMI_PRIVATE_KEY)
  throw new Error("Set a throwaway AOMI_PRIVATE_KEY");
const account = privateKeyToAccount(
  process.env.AOMI_PRIVATE_KEY as `0x${string}`,
);
const aomi = new Aomi({ baseUrl, auth: wallet(account) });
const credits = await aomi.account.credits.get();
const apps = await aomi.account.apps.list();
const wallets = await aomi.account.wallets.list();
console.log({
  balanceMicrousd: credits.balance_microusd,
  apps: apps.map((app) => app.name),
  wallets,
});
