import { Aomi, wallet } from "@aomi-labs/client";
import { privateKeyToAccount } from "viem/accounts";

const baseUrl = process.env.AOMI_BASE_URL || "https://chat.aomi.dev";
if (!process.env.AOMI_PRIVATE_KEY)
  throw new Error("Set a throwaway AOMI_PRIVATE_KEY");
const account = privateKeyToAccount(
  process.env.AOMI_PRIVATE_KEY as `0x${string}`,
);
const aomi = new Aomi({ baseUrl, auth: wallet(account) });
// Discover operation names and schemas on your deployment; no app is required.
const catalog = await aomi.pipeline.operations();
console.log(`Default-app operations: ${catalog.entries.length}`);
const build = await aomi.pipeline.build("evm_stage_tx", {
  to: account.address,
  description: "Review transfer",
  chain_id: 11155111, // Sepolia
  value: "0",
  data: { signature: "", args: [], raw: "0x" },
});
console.dir(
  {
    digest: build.digest,
    simulation: build.simulation,
    balanceChanges: build.balanceChanges,
    approvals: build.approvals,
  },
  { depth: null },
);
// Review only: no build.commit(), signing, or broadcast.
