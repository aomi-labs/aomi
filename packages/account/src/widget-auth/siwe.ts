import { getAddress } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { verifyEoaSiweMessage } from "../better-auth/siwe";
import { getOrCreateAomiUserForSiwe } from "../service/account-service";
import {
  challengeIdentifier,
  createWidgetChallenge,
  type WidgetChallenge,
} from "./challenge";
import {
  requireWidgetOrigin,
  WidgetAuthError,
  widgetOriginDomain,
} from "./origin";
import { issueWidgetSession, type AccountSession } from "./session";
import { widgetAuthStore, type WidgetAuthStore } from "./store";

export const WIDGET_SIWE_NONCE_TTL_SECONDS = 5 * 60;
const SIWE_CHALLENGE_NAMESPACE = "aomi:widget:siwe:";

export type WidgetSiweChallenge = WidgetChallenge;

export function createWidgetSiweChallenge(input: {
  request: Request;
  walletAddress: string;
  chainId: number;
  now?: Date;
  ttlSeconds?: number;
  store?: WidgetAuthStore;
}): Promise<WidgetSiweChallenge> {
  return createWidgetChallenge({
    request: input.request,
    namespace: SIWE_CHALLENGE_NAMESPACE,
    ttlSeconds: input.ttlSeconds ?? WIDGET_SIWE_NONCE_TTL_SECONDS,
    now: input.now,
    store: input.store,
    buildTicket: ({ origin, issuedAt, expiresAt }) => ({
      kind: "siwe_challenge",
      origin,
      address: requireAddress(input.walletAddress),
      chainId: requireChainId(input.chainId),
      issuedAt,
      expiresAt,
    }),
  });
}

export async function verifyWidgetSiweProof(input: {
  request: Request;
  message: string;
  signature: string;
  walletAddress: string;
  chainId: number;
  now?: Date;
  store?: WidgetAuthStore;
}): Promise<AccountSession> {
  const origin = requireWidgetOrigin(input.request);
  const address = requireAddress(input.walletAddress);
  const chainId = requireChainId(input.chainId);
  const now = input.now ?? new Date();
  const parsed = parseSiweMessage(input.message);
  const nonce = parsed.nonce;
  if (!nonce) throw new WidgetAuthError("invalid_siwe_message", 400);
  const store = input.store ?? widgetAuthStore;
  const ticket = await store.read({
    identifier: challengeIdentifier(SIWE_CHALLENGE_NAMESPACE, nonce),
    now,
  });
  if (ticket?.kind !== "siwe_challenge") {
    throw new WidgetAuthError("invalid_or_expired_nonce", 401);
  }
  const matches =
    ticket.origin === origin &&
    ticket.address.toLowerCase() === address.toLowerCase() &&
    ticket.chainId === chainId &&
    parsed.chainId === chainId &&
    parsed.uri === origin &&
    parsed.issuedAt?.toISOString() === ticket.issuedAt &&
    parsed.expirationTime?.toISOString() === ticket.expiresAt &&
    validateSiweMessage({
      message: parsed,
      address,
      domain: widgetOriginDomain(origin),
      nonce,
      time: now,
    });
  if (!matches) throw new WidgetAuthError("siwe_message_mismatch", 401);
  // LIMITATION: the widget SIWE path verifies EOA signatures only. Unlike the
  // first-party Better Auth SIWE flow (`verifySiweMessage`), it does NOT fall
  // back to on-chain EIP-1271 / ERC-6492 verification, so smart-contract
  // wallets (Coinbase Smart Wallet, Safe, Base Account, etc.) cannot sign in
  // through the widget today. Contract-wallet support is intentionally deferred
  // (it needs a per-chain public client + counterfactual deploy call); do not
  // silently widen this to `verifySiweMessage` without that plumbing.
  if (
    !(await verifyEoaSiweMessage({
      message: input.message,
      signature: input.signature,
      address,
    }))
  ) {
    throw new WidgetAuthError("invalid_siwe_signature", 401);
  }
  const consumed = await store.consume({
    identifier: challengeIdentifier(SIWE_CHALLENGE_NAMESPACE, nonce),
    now,
  });
  if (consumed?.kind !== "siwe_challenge") {
    throw new WidgetAuthError("nonce_already_used", 409);
  }
  const user = await getOrCreateAomiUserForSiwe({ address, chainId });
  return issueWidgetSession({
    userId: user.id,
    origin,
    authMethod: "siwe",
    now,
    store,
  });
}

function requireAddress(address: string): `0x${string}` {
  try {
    return getAddress(address) as `0x${string}`;
  } catch {
    throw new WidgetAuthError("invalid_wallet_address", 400);
  }
}

function requireChainId(chainId: number): number {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new WidgetAuthError("invalid_chain_id", 400);
  }
  return chainId;
}
