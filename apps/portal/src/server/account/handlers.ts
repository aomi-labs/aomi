import "server-only";
import {
  createWalletLinkNonce,
  deactivateAomiAccount,
  exchangeProviderForExistingSession,
  getAccountResponseForBetterAuthSession,
  getAccountResponseForWidgetSession,
  linkVerifiedProviderIdentityForUser,
  renameAuthIdentity,
  renameWallet,
  unlinkAuthIdentity,
  unlinkWallet,
  updateAccountProfile,
  upsertVerifiedWallet,
  verifyWalletLinkNonce,
  verifyWalletLinkSignature,
  walletLinkMessageMatches,
} from "@aomi-labs/account/account";
import {
  mintAccountBearer,
  type AomiAccountCredential,
  type WalletFamily,
} from "@aomi-labs/account";
import { auth, readAccountAuthEnv } from "@aomi-labs/account/better-auth";
import { revokeWidgetSession } from "@aomi-labs/account/widget-auth";
import { BACKEND_API_HEADERS, forward } from "@aomi-labs/account/forward";
import { recoverMessageAddress } from "viem";

import { portalFailures } from "@/server/bff/failures";
import { mintBearer } from "@/server/bff/http";
import { PrincipalError, type Principal } from "@/server/bff/principal";
import type { Call } from "@/server/bff/routes";
import { backendUrl } from "@/server/env";
import { verifyWidgetProviderCredential } from "@/server/widget-auth/exchange";
import { createCliSession, revokeSession } from "./cli-session";
import { sessionUserSeed } from "./session";
import { shortAddress } from "@aomi-labs/client";

type Account = Extract<
  Principal,
  { kind: "cookie" | "session_bearer" | "widget" }
>;

/** Local account routes only serve portal sessions and widget sessions. */
function account(principal: Principal): Account {
  if (
    principal.kind === "cookie" ||
    principal.kind === "session_bearer" ||
    principal.kind === "widget"
  )
    return principal;
  throw new Error(`account route reached with a ${principal.kind} principal`);
}

export async function accountResponse(principal: Account) {
  if (principal.kind === "widget") {
    return getAccountResponseForWidgetSession({
      userId: principal.accountId,
      expiresAt: principal.expiresAt,
      authMethod: principal.authMethod,
    });
  }
  return getAccountResponseForBetterAuthSession({
    ...sessionUserSeed(principal.session)!,
    expiresAt: principal.session.session?.expiresAt,
    fresh: principal.session.session?.fresh,
  });
}

async function body<T>(request: Request): Promise<T | null> {
  return (await request.json().catch(() => null)) as T | null;
}

function error(status: number, code: string, extra?: object): Response {
  return Response.json({ ...extra, error: code }, { status });
}

export async function readAccount({ principal }: Call): Promise<Response> {
  if (
    principal.kind === "none" ||
    (principal.kind !== "widget" && principal.guest)
  ) {
    const guest =
      principal.kind === "cookie" || principal.kind === "session_bearer";
    return Response.json({
      guest,
      user: null,
      linkedAccounts: [],
      wallets: [],
      session: guest
        ? {
            carrier: "better_auth",
            betterAuthUserId: principal.betterAuthUserId,
          }
        : null,
    });
  }
  return Response.json(await accountResponse(account(principal)));
}

export async function updateProfile({
  request,
  principal,
}: Call): Promise<Response> {
  const current = account(principal);
  const input = await body<{
    displayName?: string | null;
    avatarUrl?: string | null;
  }>(request);
  if (!input) return error(400, "invalid_json");
  await updateAccountProfile({
    userId: current.accountId,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
  });
  return Response.json(await accountResponse(current));
}

export async function deactivateAccount({
  request,
  principal,
}: Call): Promise<Response> {
  const current = account(principal);
  const result = await deactivateAomiAccount({ userId: current.accountId });
  if (result.status === "not_found") return error(404, "account_not_found");
  if (current.kind === "widget") {
    await revokeWidgetSession({ request });
    return Response.json(result);
  }
  const signOut = new URL("/api/auth/sign-out", request.url);
  const signOutResponse = await auth.handler(
    new Request(signOut, { method: "POST", headers: request.headers }),
  );
  return Response.json(result, { headers: signOutResponse.headers });
}

export async function renameIdentity({
  request,
  principal,
  params,
}: Call): Promise<Response> {
  const current = account(principal);
  const input = await body<{ displayLabel?: string | null }>(request);
  if (!input || !("displayLabel" in input))
    return error(400, "display_label_required");
  const result = await renameAuthIdentity({
    userId: current.accountId,
    identityId: String(params.id),
    displayLabel: input.displayLabel ?? null,
  });
  if (result === "not_found") return error(404, "identity_not_found");
  if (result === "protected") return error(403, "protected_identity");
  return Response.json(await accountResponse(current));
}

export async function unlinkIdentity({
  principal,
  params,
}: Call): Promise<Response> {
  const result = await unlinkAuthIdentity({
    userId: account(principal).accountId,
    identityId: String(params.id),
  });
  if (result === "not_found") return error(404, "identity_not_found");
  if (result === "protected") return error(403, "protected_identity");
  if (result === "last_factor")
    return error(409, "cannot_unlink_last_login_factor");
  return Response.json({ status: "revoked" });
}

export async function renameAccountWallet({
  request,
  principal,
  params,
}: Call): Promise<Response> {
  const current = account(principal);
  const input = await body<{ label?: string | null }>(request);
  if (!input || !("label" in input)) return error(400, "label_required");
  const renamed = await renameWallet({
    userId: current.accountId,
    walletId: String(params.id),
    label: input.label ?? null,
  });
  if (!renamed) return error(404, "wallet_not_found");
  return Response.json(await accountResponse(current));
}

export async function unlinkAccountWallet({
  principal,
  params,
}: Call): Promise<Response> {
  const current = account(principal);
  const result = await unlinkWallet({
    userId: current.accountId,
    walletId: String(params.id),
    betterAuthUserId:
      current.kind === "widget" ? null : current.betterAuthUserId,
  });
  if (result === "not_found") return error(404, "wallet_not_found");
  if (result === "last_factor")
    return error(409, "cannot_unlink_last_login_factor");
  return Response.json({ status: "revoked" });
}

export async function linkProvider({
  request,
  principal,
}: Call): Promise<Response> {
  const current = account(principal);
  const credential = await body<
    AomiAccountCredential | Record<string, unknown>
  >(request);
  if (!credential) return error(400, "invalid_json");
  if (current.kind === "widget") {
    const { descriptor, identity } =
      await verifyWidgetProviderCredential(credential);
    const result = await linkVerifiedProviderIdentityForUser({
      userId: current.accountId,
      identity,
      policy: descriptor.policy,
    });
    if (result.status === "conflict")
      return error(409, "already_linked_to_another_account", result);
    return Response.json({
      status: "linked",
      account: await accountResponse(current),
    });
  }
  const result = await exchangeProviderForExistingSession({
    betterAuthUserId: current.betterAuthUserId,
    currentUserId: current.accountId,
    credential: credential as AomiAccountCredential,
  });
  if (result.status === "conflict")
    return error(409, "already_linked_to_another_account", result);
  return Response.json(result);
}

export async function walletLinkNonce({
  request,
  principal,
}: Call): Promise<Response> {
  const current = account(principal);
  const url = new URL(request.url);
  const address = url.searchParams.get("address");
  const rawChainId = url.searchParams.get("chainId");
  const chainId = Number(rawChainId);
  if (!address || !rawChainId || !Number.isInteger(chainId) || chainId <= 0)
    return error(400, "address_and_chain_id_required");
  const env = readAccountAuthEnv();
  return Response.json({
    nonce: createWalletLinkNonce({
      userId: current.accountId,
      address,
      chainId,
      domain: env.siweDomain,
      secret: env.betterAuthSecret,
    }),
    domain: env.siweDomain,
    uri: env.betterAuthUrl,
  });
}

export async function linkWallet({
  request,
  principal,
}: Call): Promise<Response> {
  const current = account(principal);
  const input = await body<{
    family?: WalletFamily;
    address?: string;
    chainId?: number;
    nonce?: string;
    message?: string;
    signature?: string;
    label?: string | null;
  }>(request);
  if (!input?.family || !input.address)
    return error(400, "family_and_address_required");
  if (input.family !== "evm") return error(400, "unsupported_wallet_family");
  if (!input.message || !input.signature || !input.chainId)
    return error(400, "wallet_signature_required");
  const env = readAccountAuthEnv();
  const proof = {
    address: input.address,
    chainId: input.chainId,
    domain: env.siweDomain,
  };
  if (
    !input.nonce ||
    !verifyWalletLinkNonce({
      ...proof,
      nonce: input.nonce,
      userId: current.accountId,
      secret: env.betterAuthSecret,
    })
  )
    return error(401, "invalid_wallet_link_nonce");
  const signed = { ...proof, message: input.message, nonce: input.nonce };
  if (
    !(await verifyWalletLinkSignature({
      ...signed,
      signature: input.signature,
    }))
  )
    return walletSignatureMismatch(request, signed, input.signature);

  const resolution = await upsertVerifiedWallet({
    userId: current.accountId,
    family: input.family,
    address: input.address,
    chainId: input.chainId,
    chainScope: null,
    kind: "external",
    provider: "siwe",
    linkedVia: "siwe",
    label: input.label ?? null,
  });
  if (resolution.status === "conflict")
    return error(409, "already_linked_to_another_account", resolution);
  return Response.json({
    status: resolution.status,
    account: await accountResponse(current),
  });
}

/** A rejected wallet signature, with a redacted diagnostic of why it did not match. */
async function walletSignatureMismatch(
  request: Request,
  signed: {
    address: string;
    chainId: number;
    domain: string;
    message: string;
    nonce: string;
  },
  signature: string,
): Promise<Response> {
  const recovered = await recoverMessageAddress({
    message: signed.message,
    signature: signature as `0x${string}`,
  }).catch(() => null);
  const lines = signed.message.split(/\r?\n/);
  const domainPrefix = `${signed.domain} wants to link this wallet`;
  return portalFailures.handle({
    source: "expected",
    response: { status: 401, error: "invalid_wallet_signature" },
    context: {
      routeFamily: "/v1/account/wallets/link",
      operation: "wallet.link",
      method: request.method,
    },
    localDiagnostic: {
      kind: "wallet.signature_mismatch",
      attributes: {
        expected_address: shortAddress(signed.address),
        recovered_address: recovered ? shortAddress(recovered) : null,
        chain_id: signed.chainId,
        message_matches: walletLinkMessageMatches(signed),
        message_line_count: lines.length,
        first_line_prefix: lines[0]?.slice(0, 80) ?? null,
        expected_domain_prefix: domainPrefix,
        first_line_matches_domain: lines[0]?.startsWith(domainPrefix) ?? false,
        address_line: lines[1] ? shortAddress(lines[1]) : null,
        address_matches:
          lines[1]?.toLowerCase() === signed.address.toLowerCase(),
        chain_line: lines.find((line) => line.startsWith("Chain ID: ")) ?? null,
        chain_matches: lines.includes(`Chain ID: ${signed.chainId}`),
        nonce_line_present: lines.some((line) => line.startsWith("Nonce: ")),
        nonce_matches: lines.includes(`Nonce: ${signed.nonce}`),
      },
    },
  }).response;
}

/** Rotate a CLI's session: the presented one is revoked once its one-day replacement exists. */
export async function rotateCliSession({ principal }: Call): Promise<Response> {
  if (principal.kind !== "session_bearer")
    throw new PrincipalError(403, "insufficient_scope");
  const next = await createCliSession(principal.betterAuthUserId);
  await revokeSession(principal.session.session?.token);
  return Response.json(next, { headers: { "cache-control": "no-store" } });
}

export async function backendBearer({ principal }: Call): Promise<Response> {
  if (principal.kind === "none" || principal.kind === "oauth")
    throw new PrincipalError(401, "unauthenticated");
  const { bearer, expiresAt } = await mintBearer(() =>
    mintAccountBearer(principal.accountId),
  );
  return Response.json({ bearer, expires_at: expiresAt });
}

const DELEGATION_CALLBACK_FIELDS = {
  privy: ["state", "access_token", "user_id"],
  para: ["state", "para_jwt", "user_id"],
} as const;

/** Record a provider's signing delegation with the backend; the provider calls this, not a signed-in user. */
export async function recordDelegation(
  { request }: Call,
  provider: "privy" | "para",
): Promise<Response> {
  const input = await body<Record<string, unknown>>(request.clone());
  if (
    !input ||
    DELEGATION_CALLBACK_FIELDS[provider].some(
      (field) => typeof input[field] !== "string",
    ) ||
    (provider === "privy" && !Array.isArray(input.wallets))
  )
    return error(400, `invalid_${provider}_callback`);
  const upstream = await forward({
    request,
    url: new URL(`/api/auth/${provider}/callback`, backendUrl()),
    policy: BACKEND_API_HEADERS,
  });
  if (!upstream.ok)
    return error(upstream.status, `${provider}_delegation_rejected`);
  return Response.json({ status: "connected" });
}
