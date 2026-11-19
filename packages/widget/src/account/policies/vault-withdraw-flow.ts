import { shortAddress, type WalletEip712Payload } from "@aomi-labs/client";
import { connectedAddress } from "@/account/rules/rule-change-card";
import { sameWallet } from "@/account/rules/rules-model";
import type { AomiWalletKit } from "@/wallet/types";
import { sendPlainTransaction, switchToChain } from "./policy-enforcement";
import type { VaultReader } from "./vault-chain";
import type { Vault } from "./vault-model";
import {
  freshSalt,
  withdrawCalldata,
  withdrawSigningArgs,
  withdrawTypedData,
  type WithdrawAsset,
} from "./vault-withdraw";

/** How long a signed withdrawal stays redeemable. */
export const WITHDRAW_SECONDS = 600;

/** The parts of the wallet kit a withdrawal uses. */
export type WithdrawKit = Pick<
  AomiWalletKit,
  "identity" | "switchChain" | "signTypedData" | "sendTransaction"
>;

/**
 * Whether the connected EVM wallet is the vault's owner, and if not, which
 * wallet to connect (the same hint a policy's signing step gives). Only the
 * owner's own account can sign a withdrawal.
 */
export function vaultSigner(
  kit: Pick<AomiWalletKit, "identity">,
  owner: string,
): { canSign: boolean; hint: string | null } {
  const connected = connectedAddress(kit, "evm");
  if (sameWallet({ family: "evm", address: owner }, "evm", connected))
    return { canSign: true, hint: null };
  return { canSign: false, hint: `Connect ${shortAddress(owner)} to sign.` };
}

/**
 * Withdraw `amount` of `asset` from the owner's vault to the owner, with
 * nothing stored and nothing sent to Aomi. In order: the vault must have code
 * (`"no_vault"` if not, and nothing is asked of the wallet); the wallet goes
 * to the vault's chain; the owner's wallet signs the delegation (valid for
 * `WITHDRAW_SECONDS`, a fresh salt); the same wallet sends the transaction
 * `withdrawCalldata` builds from it. Resolves `"sent"` once the wallet has
 * the receipt; throws what the wallet or the guards refused.
 */
export async function withdrawFromVault(
  kit: WithdrawKit,
  reader: Pick<VaultReader, "hasCode">,
  request: { vault: Vault; asset: WithdrawAsset; amount: bigint },
): Promise<"sent" | "no_vault"> {
  const { vault, asset, amount } = request;
  const { owner, chainId } = vault;
  const { signTypedData, sendTransaction } = kit;
  if (!signTypedData || !sendTransaction)
    throw new Error("This wallet can't sign that.");
  if (amount <= BigInt(0)) throw new Error("The amount must be above 0.");
  // The transaction goes out from the connected account, and only the owner's
  // own signature redeems the delegation: it must be the owner's.
  if (!vaultSigner(kit, owner).canSign)
    throw new Error(
      "Send this from the wallet that owns the vault. Nothing was signed.",
    );
  if (!(await reader.hasCode(chainId, vault.address))) return "no_vault";

  const typed = withdrawTypedData({
    chainId,
    vault: vault.address,
    owner,
    salt: freshSalt(),
    deadline: Math.floor(Date.now() / 1000) + WITHDRAW_SECONDS,
  });
  await switchToChain(kit, chainId);
  const { signature } = await signTypedData({
    typed_data: withdrawSigningArgs(
      typed,
    ) as unknown as WalletEip712Payload["typed_data"],
    signer: owner,
    chainId,
    description: "Withdraw from your vault",
  });
  const tx = withdrawCalldata({
    delegation: typed.message,
    signature,
    asset,
    owner,
    amount,
  });
  await sendPlainTransaction(sendTransaction, {
    requestId: "vault-withdraw",
    chainId,
    ...tx,
  });
  return "sent";
}
