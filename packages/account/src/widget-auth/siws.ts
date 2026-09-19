import {
  parseSiwsMessage,
  SIWS_CLUSTERS,
  validSolanaAddress,
  verifySiwsMessage,
  type SiwsCluster,
} from "../better-auth/siws";
import { getOrCreateAomiUserForSiws } from "../service/account-service";
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

const SIWS_CHALLENGE_NAMESPACE = "aomi:widget:siws:";
export const WIDGET_SIWS_NONCE_TTL_SECONDS = 5 * 60;

export type WidgetSiwsChallenge = WidgetChallenge;

export function createWidgetSiwsChallenge(input: {
  request: Request;
  walletAddress: string;
  chainId: string;
  now?: Date;
  ttlSeconds?: number;
  store?: WidgetAuthStore;
}): Promise<WidgetSiwsChallenge> {
  return createWidgetChallenge({
    request: input.request,
    namespace: SIWS_CHALLENGE_NAMESPACE,
    ttlSeconds: input.ttlSeconds ?? WIDGET_SIWS_NONCE_TTL_SECONDS,
    now: input.now,
    store: input.store,
    buildTicket: ({ origin, issuedAt, expiresAt }) => ({
      kind: "siws_challenge",
      origin,
      address: requireSolanaAddress(input.walletAddress),
      chainId: requireSiwsCluster(input.chainId),
      issuedAt,
      expiresAt,
    }),
  });
}

export async function verifyWidgetSiwsProof(input: {
  request: Request;
  message: string;
  signature: string;
  walletAddress: string;
  chainId: string;
  now?: Date;
  store?: WidgetAuthStore;
}): Promise<AccountSession> {
  const origin = requireWidgetOrigin(input.request);
  const address = requireSolanaAddress(input.walletAddress);
  const chainId = requireSiwsCluster(input.chainId);
  const now = input.now ?? new Date();
  // Use the strict SIWS parser (same one `verifySiwsMessage` relies on) rather
  // than hand-scanning individual fields, so the nonce/issued-at we bind
  // against come from a fully-validated message shape.
  const parsed = parseSiwsMessage(input.message);
  if (!parsed) throw new WidgetAuthError("invalid_siws_message", 400);
  const nonce = parsed.nonce;
  const store = input.store ?? widgetAuthStore;
  const ticket = await store.read({
    identifier: challengeIdentifier(SIWS_CHALLENGE_NAMESPACE, nonce),
    now,
  });
  if (ticket?.kind !== "siws_challenge") {
    throw new WidgetAuthError("invalid_or_expired_nonce", 401);
  }
  const valid =
    ticket.origin === origin &&
    ticket.address === address &&
    ticket.chainId === chainId &&
    parsed.address === address &&
    parsed.chainId === chainId &&
    parsed.uri === origin &&
    parsed.issuedAt === ticket.issuedAt &&
    verifySiwsMessage({
      message: input.message,
      signature: input.signature,
      walletAddress: address,
      chainId,
      intent: "sign-in",
      nonce,
      domain: widgetOriginDomain(origin),
      uri: origin,
      now: now.getTime(),
    });
  if (!valid) throw new WidgetAuthError("invalid_siws_signature", 401);
  const consumed = await store.consume({
    identifier: challengeIdentifier(SIWS_CHALLENGE_NAMESPACE, nonce),
    now,
  });
  if (consumed?.kind !== "siws_challenge") {
    throw new WidgetAuthError("nonce_already_used", 409);
  }
  const user = await getOrCreateAomiUserForSiws({ address, chainId });
  return issueWidgetSession({
    userId: user.id,
    origin,
    authMethod: "siws",
    now,
    store,
  });
}

function requireSolanaAddress(address: string): string {
  if (!validSolanaAddress(address)) {
    throw new WidgetAuthError("invalid_wallet_address", 400);
  }
  return address;
}

function requireSiwsCluster(value: string): SiwsCluster {
  if (!SIWS_CLUSTERS.includes(value as SiwsCluster)) {
    throw new WidgetAuthError("invalid_chain_id", 400);
  }
  return value as SiwsCluster;
}
