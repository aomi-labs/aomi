import { randomBytes } from "node:crypto";
import { verifySiweMessage } from "../better-auth/siwe";
import { storeVerification, takeVerification } from "../db/queries";
import type { WalletFamily } from "../types";
import { normalizeWalletAddress } from "./wallet-normalization";

export const WALLET_LINK_NONCE_MAX_AGE_MS = 5 * 60 * 1000;

/** What a link nonce is bound to: the account, the address and its chain. */
export type WalletLinkTarget = {
  userId: string;
  family: WalletFamily;
  address: string;
  /** EVM chain id, or the SVM cluster. */
  chainId: number | string;
};

/** Issue a single-use link nonce, stored until the link consumes it. */
export async function issueWalletLinkNonce(
  target: WalletLinkTarget,
): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  await storeVerification({
    identifier: walletLinkIdentifier(nonce),
    value: walletLinkBinding(target),
    expiresAt: new Date(Date.now() + WALLET_LINK_NONCE_MAX_AGE_MS),
  });
  return nonce;
}

/** Consume the nonce; true only once, and only for the target it was issued to. */
export async function consumeWalletLinkNonce(
  input: WalletLinkTarget & { nonce: string },
): Promise<boolean> {
  const stored = await takeVerification(walletLinkIdentifier(input.nonce));
  return stored !== null && stored === walletLinkBinding(input);
}

function walletLinkIdentifier(nonce: string): string {
  return `aomi:wallet-link:${nonce}`;
}

function walletLinkBinding(target: WalletLinkTarget): string {
  return JSON.stringify([
    target.userId,
    target.family,
    normalizeWalletAddress(target.family, target.address),
    String(target.chainId),
  ]);
}

export async function verifyWalletLinkSignature(input: {
  message: string;
  signature: string;
  address: string;
  chainId: number;
  nonce: string;
  domain: string;
}): Promise<boolean> {
  if (
    !walletLinkMessageMatches({
      message: input.message,
      address: input.address,
      chainId: input.chainId,
      nonce: input.nonce,
      domain: input.domain,
    })
  ) {
    return false;
  }
  return verifySiweMessage({
    address: input.address,
    message: input.message,
    signature: input.signature,
    chainId: input.chainId,
  });
}

export function walletLinkMessageMatches(input: {
  message: string;
  address: string;
  chainId: number;
  nonce: string;
  domain: string;
}): boolean {
  const parsed = parseWalletLinkMessage(input.message);
  return Boolean(
    parsed &&
    parsed.domain === input.domain &&
    parsed.address.toLowerCase() === input.address.toLowerCase() &&
    parsed.chainId === input.chainId &&
    parsed.nonce === input.nonce,
  );
}

export type ParsedWalletLinkMessage = {
  domain: string;
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
};

export function parseWalletLinkMessage(
  message: string,
): ParsedWalletLinkMessage | null {
  const lines = message.split(/\r?\n/);
  const domainMatch = lines[0]?.match(
    /^(.+) wants (?:to link this wallet to your Aomi account|you to sign in with your Ethereum account):$/,
  );
  if (!domainMatch) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(lines[1] ?? "")) return null;
  const fields = {
    uri: readField(lines, "URI"),
    version: readField(lines, "Version"),
    chainId: readField(lines, "Chain ID"),
    nonce: readField(lines, "Nonce"),
    issuedAt: readField(lines, "Issued At"),
  };
  if (
    !fields.uri ||
    fields.version !== "1" ||
    !fields.chainId ||
    !fields.nonce ||
    !fields.issuedAt
  ) {
    return null;
  }
  const chainId = Number(fields.chainId);
  if (
    !Number.isInteger(chainId) ||
    chainId <= 0 ||
    String(chainId) !== fields.chainId
  ) {
    return null;
  }
  if (Number.isNaN(Date.parse(fields.issuedAt))) return null;

  return {
    domain: domainMatch[1],
    address: lines[1],
    uri: fields.uri,
    chainId,
    nonce: fields.nonce,
    issuedAt: fields.issuedAt,
  };
}

function readField(lines: readonly string[], field: string): string | null {
  const prefix = `${field}: `;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (!line) return null;
  return line.slice(prefix.length);
}
