import { hashMessage, isHex, parseSignature, serializeSignature } from "viem";
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

function findParaSigningWallet(
  paraSession: ParaSigningClient,
  address: `0x${string}`,
): ParaSigningWallet | undefined {
  const wallet = paraSession.findWalletByAddress?.(address, { type: ["EVM"] });
  if (wallet) return wallet;

  return Object.values(paraSession.wallets ?? {}).find(
    (candidate) =>
      candidate.address?.toLowerCase() === address.toLowerCase() &&
      (!candidate.type || candidate.type === "EVM"),
  );
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
