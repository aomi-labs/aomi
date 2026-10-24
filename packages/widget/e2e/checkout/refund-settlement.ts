/** Testnet-only manual treasury refund probe; Payment never receives this key. */
import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

async function main() {
  if (process.env.PAYMENT_TEST_REFUND !== "1")
    throw new Error("Explicit test refund opt-in required");
  const payer = privateKeyToAccount(process.env.BANANA_PRIVATE_KEY as Hex);
  const treasury = privateKeyToAccount(
    readFileSync(process.env.TEST_TREASURY_KEY_FILE!, "utf8").trim() as Hex,
  );
  if (
    treasury.address.toLowerCase() !==
      process.env.TEST_TREASURY_ADDRESS?.toLowerCase() ||
    payer.address === treasury.address
  )
    throw new Error("Unexpected test treasury");
  const transport = http("https://sepolia.base.org");
  const rpc = createPublicClient({ chain: baseSepolia, transport });
  if ((await rpc.getChainId()) !== 84532)
    throw new Error("Refusing non-testnet RPC");
  const asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const amount = BigInt(250_000);
  const balances = () =>
    Promise.all(
      [payer.address, treasury.address].map((address) =>
        rpc.readContract({
          address: asset,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
      ),
    );
  const before = await balances();
  if (before[1] < amount) throw new Error("Test treasury lacks refund USDC");
  if (
    (await rpc.getBalance({ address: treasury.address })) <
    BigInt(10_000_000_000_000)
  ) {
    const gas = await createWalletClient({
      account: payer,
      chain: baseSepolia,
      transport,
    }).sendTransaction({
      to: treasury.address,
      value: BigInt(10_000_000_000_000),
    });
    const receipt = await rpc.waitForTransactionReceipt({
      hash: gas,
      confirmations: 2,
    });
    if (receipt.status !== "success")
      throw new Error("Test gas funding failed");
  }
  const simulation = await rpc.simulateContract({
    account: treasury,
    address: asset,
    abi: erc20Abi,
    functionName: "transfer",
    args: [payer.address, amount],
  });
  if (!simulation.result) throw new Error("Refund simulation failed");
  const hash = await createWalletClient({
    account: treasury,
    chain: baseSepolia,
    transport,
  }).writeContract(simulation.request);
  const receipt = await rpc.waitForTransactionReceipt({
    hash,
    confirmations: 2,
  });
  const after = await balances();
  const evidence = {
    network: "eip155:84532",
    transaction: hash,
    receipt_status: receipt.status,
    amount_microusd: Number(amount),
    payer: payer.address,
    treasury: treasury.address,
    payer_delta: String(after[0] - before[0]),
    treasury_delta: String(after[1] - before[1]),
  };
  if (process.env.PAYMENT_EVIDENCE_FILE)
    writeFileSync(
      process.env.PAYMENT_EVIDENCE_FILE,
      JSON.stringify(evidence, null, 2),
    );
  console.log(JSON.stringify(evidence));
  if (
    receipt.status !== "success" ||
    after[0] - before[0] !== amount ||
    before[1] - after[1] !== amount
  )
    throw new Error("Refund balance evidence mismatch");
}
main().catch(() => {
  console.error(
    "Testnet refund probe failed; inspect redacted receipt evidence before retrying.",
  );
  process.exitCode = 1;
});
