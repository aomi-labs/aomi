/** Local testnet-only acceptance probe. Never emits keys or signed payloads. */
import { createPublicClient, erc20Abi, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AomiClient, createEvmPaymentClient } from "../../../client/src/index";
import { writeFileSync } from "node:fs";
const secret = process.env.BANANA_PRIVATE_KEY;
if (!secret) throw new Error("BANANA_PRIVATE_KEY test signer required");
const signer = privateKeyToAccount(secret as Hex);
const client = new AomiClient({
  guest: false,
  baseUrl: "http://127.0.0.1:18080",
});
const methods = await client.account.credits.methods();
const terms = methods.wallet.networks.find((n) => n.network === "eip155:84532");
if (
  !terms ||
  terms.asset.toLowerCase() !== "0x036cbd53842c5426634e7929541ec2318f3dcf7e"
)
  throw new Error("Expected native Base Sepolia test USDC");
if (signer.address.toLowerCase() === terms.recipient.toLowerCase())
  throw new Error("Payer and test treasury must differ");
const rpc = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org"),
});
if ((await rpc.getChainId()) !== 84532)
  throw new Error("Testnet identity mismatch");
const balances = async () =>
  Promise.all(
    [signer.address, terms.recipient].map((address) =>
      rpc.readContract({
        address: terms.asset as Hex,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as Hex],
      }),
    ),
  );
const before = await balances();
if (before[0] < 1_000_000n) throw new Error("Test wallet needs 1 testnet USDC");
const x402 = createEvmPaymentClient(
  {
    address: signer.address,
    chainId: 84532,
    signTypedData: async ({ typedData }) => {
      const data = typedData as any;
      if (
        Number(data.domain.chainId) !== 84532 ||
        data.domain.verifyingContract.toLowerCase() !==
          terms.asset.toLowerCase() ||
        data.message.to.toLowerCase() !== terms.recipient.toLowerCase() ||
        BigInt(data.message.value) !== 1_000_000n
      )
        throw new Error("Refusing authorization outside exact test purchase");
      return signer.signTypedData(data);
    },
  },
  { amountMicrousd: 1_000_000, ...terms },
);
const key = `testnet-${crypto.randomUUID()}`;
let checkout;
try {
  checkout = await client.account.credits.beginPurchase({
    amountMicrousd: 1_000_000,
    method: "wallet",
    chain: terms.network,
    idempotencyKey: key,
    x402,
  });
} catch {
  checkout = await client.account.credits.purchase("current");
}
console.log(
  JSON.stringify({
    purchase_id: checkout.purchase.id,
    status: checkout.purchase.status,
    phase: "authorization submitted",
  }),
);
for (let i = 0; i < 60 && checkout.purchase.status !== "credited"; i++) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  checkout = await client.account.credits.purchase(checkout.purchase.id);
}
const after = await balances();
const reference = checkout.purchase.provider_reference;
const tx = reference?.split(":").at(-1) as Hex;
const receipt = tx ? await rpc.getTransactionReceipt({ hash: tx }) : undefined;
const evidence = {
  purchase_id: checkout.purchase.id,
  idempotency_key: key,
  status: checkout.purchase.status,
  network: terms.network,
  payer: signer.address,
  treasury: terms.recipient,
  transaction: tx,
  receipt_status: receipt?.status,
  payer_delta: (after[0] - before[0]).toString(),
  treasury_delta: (after[1] - before[1]).toString(),
};
if (process.env.PAYMENT_EVIDENCE_FILE)
  writeFileSync(
    process.env.PAYMENT_EVIDENCE_FILE,
    JSON.stringify(evidence, null, 2),
  );
console.log(JSON.stringify(evidence));
if (
  checkout.purchase.status !== "credited" ||
  receipt?.status !== "success" ||
  before[0] - after[0] !== 1_000_000n ||
  after[1] - before[1] !== 1_000_000n
)
  process.exitCode = 1;
