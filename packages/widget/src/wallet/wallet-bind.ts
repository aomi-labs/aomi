"use client";

import {
  authorizationChallenge,
  authorizationCommit,
  type AuthorizationPoster,
  type WalletEip712Payload,
} from "@aomi-labs/client";
import { explainAccountError } from "./account-api";

export type BindWalletSigner = {
  chain: "evm" | "svm";
  address: string;
  signTypedData?: (args: WalletEip712Payload) => Promise<{ signature: string }>;
  signSolanaMessage?: (args: {
    signer?: string;
    message: string;
    cluster?: string;
    description: string;
  }) => Promise<{ signature: string }>;
  svmCluster?: string;
  signerAddress?: string;
};

const BIND_DESCRIPTION =
  "Link this wallet to your Aomi account so it can sign transactions.";

/** Run the bind permit ceremony for an EVM or SVM wallet. */
export async function bindWalletVia(
  post: AuthorizationPoster,
  signer: BindWalletSigner,
): Promise<"bound" | "already_bound"> {
  let challenge;
  try {
    challenge = await authorizationChallenge(post, {
      chain_type: signer.chain,
      wallet: signer.address,
      mode: "bind",
    });
  } catch (cause) {
    if (isAlreadyBound(cause)) return "already_bound";
    throw new Error(explainAccountError(cause));
  }

  if (signer.chain === "evm") {
    if (!challenge.typed_data || !signer.signTypedData) {
      throw new Error(
        "Connect an Ethereum wallet that can sign EIP-712 messages.",
      );
    }
    const { signature } = await signer.signTypedData({
      signer: signer.address,
      typed_data: challenge.typed_data as WalletEip712Payload["typed_data"],
      description: BIND_DESCRIPTION,
    });
    try {
      await authorizationCommit(post, { permit: challenge.permit, signature });
      return "bound";
    } catch (cause) {
      if (isAlreadyBound(cause)) return "already_bound";
      throw new Error(explainAccountError(cause));
    }
  }

  if (!challenge.message_base64 || !signer.signSolanaMessage) {
    throw new Error("Connect a Solana wallet that can sign messages.");
  }
  const { signature } = await signer.signSolanaMessage({
    signer: signer.address,
    message: challenge.message_base64,
    cluster: signer.svmCluster,
    description: BIND_DESCRIPTION,
  });
  try {
    await authorizationCommit(post, {
      permit: challenge.permit,
      signature,
      ...(signer.signerAddress ? { signer: signer.signerAddress } : {}),
    });
    return "bound";
  } catch (cause) {
    if (isAlreadyBound(cause)) return "already_bound";
    throw new Error(explainAccountError(cause));
  }
}

function isAlreadyBound(cause: unknown): boolean {
  const raw = cause instanceof Error ? cause.message : String(cause);
  return raw.includes("already_bound");
}
