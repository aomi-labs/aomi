import { Aomi, wallet } from "@aomi-labs/client";
import { viemSigner } from "@aomi-labs/client/viem";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const baseUrl = process.env.AOMI_BASE_URL || "https://chat.aomi.dev";
if (!process.env.AOMI_PRIVATE_KEY)
  throw new Error("Set a throwaway AOMI_PRIVATE_KEY");
const account = privateKeyToAccount(
  process.env.AOMI_PRIVATE_KEY as `0x${string}`,
);
const signer = viemSigner(
  createWalletClient({ account, chain: sepolia, transport: http() }),
);
const aomi = new Aomi({
  baseUrl,
  auth: wallet(account, { chainId: sepolia.id }),
  signer: { evm: signer },
});
const turn = aomi.agent
  .thread()
  .send(
    `Prepare a zero-value ETH transfer from ${account.address} to itself on Sepolia (chain 11155111). Stage and simulate it, then request my signature as a Commit. I will review it before deciding.`,
  );
const { reply, commits } = await turn;
console.log(reply);
console.log(`Commits to review: ${commits.length}`);
try {
  for (const commit of commits) {
    console.dir(
      {
        ref: commit.ref,
        kind: commit.kind,
        state: commit.state,
        review: commit.review,
      },
      { depth: null },
    );
    // A real approval UI can call await commit.sign() after review.
    // This dry run always declines: it never signs or funds a transaction.
    await commit.reject();
    console.log(`Declined ${commit.ref}`);
  }
  if (commits.length) await turn.interrupt();
} finally {
  for (const commit of commits) commit.close();
}
