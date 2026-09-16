import {
  hashMessage,
  hashTypedData,
  isHex,
  parseSignature,
  recoverTypedDataAddress,
  serializeSignature,
} from "viem";
import {
  toViemSignTypedDataArgs,
  type WalletEip712Payload,
} from "@aomi-labs/client";
import { hexToBase64 } from "../../account/encoding";

type ParaSigningWallet = {
  id?: string;
  address?: string;
  type?: string;
};

export type ParaSigningClient = {
  findWalletByAddress?: (
    address: `0x${string}`,
    filter?: { type?: ("EVM" | "SOLANA" | "COSMOS" | "STELLAR")[] },
  ) => ParaSigningWallet | undefined;
  signMessage?: (args: {
    walletId: string;
    messageBase64: string;
  }) => Promise<
    | { signature: string }
    | { pendingTransactionId: string; transactionReviewUrl: string }
  >;
  wallets?: Record<string, ParaSigningWallet>;
};

function normalizeParaSignature(signature: string): `0x${string}` {
  const normalized = signature.startsWith("0x") ? signature : `0x${signature}`;
  const parsed = parseSignature(normalized as `0x${string}`);
  return serializeSignature({
    r: parsed.r,
    s: parsed.s,
    yParity: parsed.yParity,
  });
}

export function findParaSigningWallet(
  paraSession: ParaSigningClient,
  address: string,
  family: "evm" | "svm" = "evm",
): ParaSigningWallet | undefined {
  const wallet =
    family === "evm"
      ? paraSession.findWalletByAddress?.(address as `0x${string}`, {
          type: ["EVM"],
        })
      : undefined;
  if (wallet) return wallet;

  return Object.values(paraSession.wallets ?? {}).find((candidate) =>
    family === "evm"
      ? candidate.address?.toLowerCase() === address.toLowerCase() &&
        (!candidate.type || candidate.type === "EVM")
      : candidate.address === address && candidate.type === "SOLANA",
  );
}

export async function signParaTypedData(
  paraSession: ParaSigningClient,
  address: string,
  payload: WalletEip712Payload,
): Promise<{ signature: string }> {
  const walletId = findParaSigningWallet(paraSession, address)?.id;
  const args = toViemSignTypedDataArgs(payload);
  if (!walletId || !paraSession.signMessage || !args?.message) {
    throw new Error("Para wallet is not available for typed-data signing");
  }
  const typedData = { ...args, message: args.message };
  const result = await paraSession.signMessage({
    walletId,
    messageBase64: hexToBase64(hashTypedData(typedData)),
  });
  if (!("signature" in result))
    throw new Error("Para authorization is still awaiting a signature.");
  const signature = normalizeParaSignature(result.signature);
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error(
      "Para returned a signature for a different wallet. Nothing changed.",
    );
  }
  return { signature };
}

export async function signParaSolanaMessage(
  paraSession: ParaSigningClient,
  address: string,
  messageBase64: string,
): Promise<{ signature: string }> {
  const walletId = findParaSigningWallet(paraSession, address, "svm")?.id;
  if (!walletId || !paraSession.signMessage) {
    throw new Error("Para Solana wallet is not available for signing");
  }
  // Ed25519 signs the original bytes, not an EVM personal-sign/typed-data hash.
  const result = await paraSession.signMessage({ walletId, messageBase64 });
  if (!("signature" in result))
    throw new Error("Para authorization is still awaiting a signature.");
  // Para Web SDK's ED25519_SIGN worker returns base64, unlike its EVM signer.
  if (
    !/^[A-Za-z0-9+/]{86}==$/.test(result.signature) ||
    btoa(atob(result.signature)) !== result.signature
  ) {
    throw new Error("Para returned an invalid Solana signature.");
  }
  return { signature: result.signature };
}

export async function signParaMessage(
  paraSession: ParaSigningClient,
  address: `0x${string}`,
  message: string,
): Promise<`0x${string}`> {
  const walletId = findParaSigningWallet(paraSession, address)?.id;
  if (!walletId || !paraSession.signMessage) {
    throw new Error("Para embedded wallet is not available for signing");
  }

  const result = await paraSession.signMessage({
    walletId,
    // Alchemy's personal_sign request carries bytes in `data.raw` and its
    // `rawPayload` is the EIP-191 digest of those bytes. Hashing the `0x…`
    // characters as UTF-8 produces a different signer than browser/Privy.
    messageBase64: hexToBase64(
      isHex(message) ? hashMessage({ raw: message }) : hashMessage(message),
    ),
  });
  if (!("signature" in result) || !result.signature) {
    const resultKeys = Object.keys(result).sort().join(",") || "none";
    throw new Error(
      `Para embedded wallet did not return a signature (result keys: ${resultKeys})`,
    );
  }
  return normalizeParaSignature(result.signature);
}
