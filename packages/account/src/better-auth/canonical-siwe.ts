import { createAuthEndpoint, APIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { siwe } from "better-auth/plugins";
import type { User } from "better-auth";
import { getAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { resolveWalletLogin } from "../service/wallet-login";
import { verifySiweMessage } from "./siwe";

/** Keep Better Auth's nonce/schema contract; resolve login through the canonical
 * graph only after consuming the nonce and validating the signed message. */
export function canonicalSiwe(options: Parameters<typeof siwe>[0]) {
  const plugin = siwe(options);
  return {
    ...plugin,
    endpoints: {
      ...plugin.endpoints,
      verifySiweMessage: createAuthEndpoint(
        "/siwe/verify",
        plugin.endpoints.verifySiweMessage.options,
        async (ctx) => {
          const { message, signature } = ctx.body;
          const parsed = parseSiweMessage(message);
          const nonce = parsed.nonce;
          if (
            !nonce ||
            !/^[a-zA-Z0-9]{8,250}$/.test(nonce) ||
            !(await ctx.context.internalAdapter.consumeVerificationValue(
              `siwe:${nonce}`,
            ))
          )
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid or expired SIWE nonce",
            });
          const address =
            parsed.address && /^0x[0-9a-fA-F]{40}$/.test(parsed.address)
              ? getAddress(parsed.address.toLowerCase())
              : null;
          const chainId = parsed.chainId;
          if (
            !address ||
            !chainId ||
            !Number.isInteger(chainId) ||
            chainId <= 0 ||
            normalizeDomain(parsed.domain ?? "") !==
              normalizeDomain(options.domain) ||
            (parsed.expirationTime &&
              Date.now() >= parsed.expirationTime.getTime()) ||
            (parsed.notBefore && Date.now() < parsed.notBefore.getTime())
          )
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid SIWE message",
            });
          if (
            !(await verifySiweMessage({ message, signature, address, chainId }))
          ) {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid SIWE signature",
            });
          }
          const login = await resolveWalletLogin({
            family: "evm",
            address,
            chainId,
            email: `${address}@${options.emailDomainName ?? new URL(ctx.context.baseURL).origin}`,
          });
          const user = await ctx.context.adapter.findOne<User>({
            model: "user",
            where: [{ field: "id", value: login.betterAuthUserId }],
          });
          if (!user) throw new APIError("INTERNAL_SERVER_ERROR");
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR");
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            token: session.token,
            success: true,
            user: { id: user.id, walletAddress: address, chainId },
          });
        },
      ),
    },
  };
}

function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split("/")[0];
}
