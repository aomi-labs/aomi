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

export const WITHDRAW_SECONDS = 600;

export type WithdrawKit = Pick<
  AomiWalletKit,
  "identity" | "switchChain" | "signTypedData" | "sendTransaction"
>;

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
 * Vault to owner, nothing sent to Aomi: check code (`"no_vault"` before any
 * wallet prompt), switch chain, sign, send. `"sent"` once the receipt is in.
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
  // Only the owner's own account can redeem the delegation.
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
