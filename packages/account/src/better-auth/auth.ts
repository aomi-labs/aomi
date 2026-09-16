import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { generateRandomString } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { anonymous, bearer, jwt, siwe } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { oauthDeviceAuthorization } from "@better-auth/oauth-provider";
import { getPool } from "../db/pool";
import {
  getOrCreateAomiUserForBetterAuthSession,
  linkAnonymousCanonicalAccount,
} from "../service/account-service";
import { readAccountAuthEnv } from "./env";
import {
  AOMI_CANONICAL_USER_CLAIM,
  AOMI_PRINCIPAL_CLASS_CLAIM,
  AOMI_SCOPES,
  MCP_CLIENT_REGISTRATION_SCOPES,
  aomiOAuthResourcePolicies,
  aomiOAuthResources,
} from "./oauth-policy";
import { verifySiweMessage } from "./siwe";
import { aomiSiwsPlugin } from "./siws";
import { aomiProviderAuthPlugin } from "./provider-plugin";
import { aomiWidgetOAuthBootstrapPlugin } from "./widget-bootstrap-plugin";
import { observeBetterAuthFailure } from "./failure-observer";

const env = readAccountAuthEnv();
const resources = aomiOAuthResources();
const resourcePolicies = aomiOAuthResourcePolicies();
const isLoopbackAuthRuntime = (() => {
  const hostname = new URL(env.betterAuthUrl).hostname;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
})();
// Better Auth seeds configured resources during plugin initialization. Unit
// suites import this module while intentionally running without PostgreSQL;
// the resource/scope contract remains covered by oauth-policy and route tests.
const seedOAuthResources = process.env.NODE_ENV !== "test";
const DEVICE_CODE_FIELDS: Record<string, string> = {
  deviceCode: "device_code",
  userCode: "user_code",
  userId: "user_id",
  expiresAt: "expires_at",
  status: "status",
  lastPolledAt: "last_polled_at",
  pollingInterval: "polling_interval",
  clientId: "client_id",
  scope: "scope",
  resources: "resources",
  oauthClientId: "oauth_client_id",
};

// Better Auth 1.7's separately published protocol packages resolve distinct
// @better-auth/core peer contexts under pnpm. Their runtime plugin contract is
// identical; normalize that package identity at this one integration boundary.
function compatiblePlugin<T extends object>(plugin: T): T & BetterAuthPlugin {
  return plugin as T & BetterAuthPlugin;
}

// OAuth Provider 1.7 always queries its resource table during `init`, even
// when no resources are configured. Unit suites intentionally have no
// Postgres service; retain the plugin id, schema, endpoints, and request hooks
// while omitting only that eager database lifecycle hook in tests.
function withoutTestDatabaseInit<T extends BetterAuthPlugin>(plugin: T): T {
  if (seedOAuthResources) return plugin;
  const { init: _init, ...runtimePlugin } = plugin;
  return runtimePlugin as T;
}

// BetterAuth's storage lives in the SAME database as the canonical account
// graph, but under our house schema style: `ba_`-prefixed snake_case tables
// (`ba_users`, `ba_sessions`, `ba_accounts`, `ba_verifications`,
// `ba_wallet_addresses`) so `\dt` reads as one namespaced framework block, not
// a parallel identity graph. These tables carry LOGIN state only (cookie
// sessions, credential links, short-lived challenges); durable identity stays
// in `users` / `auth_providers` / `public_keys`.
function snakeCasedSiwe(plugin: ReturnType<typeof siwe>) {
  const { fields, ...walletAddress } = plugin.schema!.walletAddress;
  return {
    ...plugin,
    schema: {
      walletAddress: {
        ...walletAddress,
        modelName: "ba_wallet_addresses",
        fields: {
          userId: { ...fields.userId, fieldName: "user_id" },
          address: fields.address,
          chainId: { ...fields.chainId, fieldName: "chain_id" },
          isPrimary: { ...fields.isPrimary, fieldName: "is_primary" },
          createdAt: { ...fields.createdAt, fieldName: "created_at" },
        },
      },
    },
  };
}

// Same ba_ + snake_case treatment for the MCP plugin's OAuth-provider models
// (client registrations, tokens, consents). Tables live in
// supabase/migrations/*_better_auth_17_oauth.sql (product-mono); keep names
// in lockstep.
function snakeCasedOAuth(plugin: ReturnType<typeof mcp>) {
  const modelNames: Record<string, string> = {
    oauthClient: "ba_oauth_clients",
    oauthResource: "ba_oauth_resources",
    oauthClientResource: "ba_oauth_client_resources",
    oauthRefreshToken: "ba_oauth_refresh_tokens",
    oauthAccessToken: "ba_oauth_access_tokens",
    oauthConsent: "ba_oauth_consents",
    oauthClientAssertion: "ba_oauth_client_assertions",
  };
  const snake = (name: string) =>
    name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const schema = Object.fromEntries(
    Object.entries(plugin.schema!).map(([model, definition]) => [
      model,
      {
        ...definition,
        modelName: modelNames[model] ?? model,
        fields: Object.fromEntries(
          Object.entries(definition.fields).map(([name, field]) => [
            name,
            { ...field, fieldName: snake(name) },
          ]),
        ),
      },
    ]),
  ) as unknown as typeof plugin.schema;
  return { ...plugin, schema };
}

export const auth = betterAuth({
  database: getPool(),
  trustedOrigins: env.trustedOrigins,
  secret: env.betterAuthSecret,
  baseURL: env.betterAuthUrl,
  basePath: "/api/auth",
  disabledPaths: ["/token"],
  rateLimit: {
    // Local browsers and integration suites all share the loopback IP, so the
    // production anonymous-account limit otherwise locks out every local
    // browser after ten total attempts. Hosted environments remain limited.
    enabled: !isLoopbackAuthRuntime,
    customRules: {
      "/sign-in/anonymous": { window: 60 * 60, max: 10 },
      "/oauth2/register": { window: 60 * 60, max: 30 },
      "/oauth2/authorize": { window: 60, max: 30 },
      "/oauth2/token": { window: 60, max: 60 },
      "/device/code": { window: 60, max: 20 },
    },
  },
  onAPIError: {
    onError: observeBetterAuthFailure,
  },
  user: {
    modelName: "ba_users",
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session: {
    modelName: "ba_sessions",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
    },
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  account: {
    modelName: "ba_accounts",
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      issuer: "issuer",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    accountLinking: {
      enabled: true,
      allowDifferentEmails: false,
      trustedProviders: [],
    },
  },
  verification: {
    modelName: "ba_verifications",
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  plugins: [
    jwt({
      issuer: resources.authorizationServerIssuer,
      disableSettingJwtHeader: true,
      jwks: {
        rotationInterval: 30 * 24 * 60 * 60,
        gracePeriod: 31 * 24 * 60 * 60,
      },
      schema: {
        jwks: {
          modelName: "ba_jwks",
          fields: {
            publicKey: "public_key",
            privateKey: "private_key",
            createdAt: "created_at",
            expiresAt: "expires_at",
            alg: "alg",
            crv: "crv",
          },
        },
      },
    }),
    snakeCasedSiwe(
      siwe({
        domain: env.siweDomain,
        emailDomainName: env.siweEmailDomain,
        anonymous: true,
        getNonce: async () => generateRandomString(32, "a-z", "A-Z", "0-9"),
        verifyMessage: verifySiweMessage,
      }),
    ),
    aomiSiwsPlugin({
      domain: env.siweDomain,
      baseUrl: env.betterAuthUrl,
      getNonce: async () => generateRandomString(32, "a-z", "A-Z", "0-9"),
    }),
    bearer(),
    anonymous({
      emailDomainName: new URL(env.betterAuthUrl).hostname,
      schema: { user: { fields: { isAnonymous: "is_anonymous" } } },
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await linkAnonymousCanonicalAccount({
          anonymousBetterAuthUserId: anonymousUser.user.id,
          newBetterAuthUserId: newUser.user.id,
          newEmail: newUser.user.email,
          newEmailVerified: newUser.user.emailVerified,
          newName: newUser.user.name,
          newAvatarUrl: newUser.user.image,
        });
      },
    }),
    withoutTestDatabaseInit(
      compatiblePlugin(
        snakeCasedOAuth(
          mcp({
            loginPage: "/oauth/authorize",
            consentPage: "/oauth/consent",
            resource: resources.agentMcp,
            resources: seedOAuthResources
              ? resourcePolicies.map((policy) => ({
                  identifier: policy.identifier,
                  allowedScopes: [...policy.grantableScopes],
                  accessTokenTtl: 5 * 60,
                  dpopBoundAccessTokensRequired:
                    policy.dpopBoundAccessTokensRequired,
                }))
              : [],
            resourceSeedMode: "overwrite",
            scopes: [...AOMI_SCOPES],
            // Do not attach server defaults to dynamic clients. Agent,
            // Pipeline, and REST registrations must remain exact-resource.
            // Codex's RFC 7591 payload omits the non-standard `resources`
            // extension, so the Portal transactionally binds that client to
            // the one resource named by its first authorize request.
            clientRegistrationDefaultResources: [],
            clientRegistrationAllowedResources: seedOAuthResources
              ? [
                  resources.agentMcp,
                  resources.pipelineMcp,
                  resources.agentRest,
                  resources.pipelineRest,
                ]
              : [],
            clientRegistrationDefaultScopes: [
              ...MCP_CLIENT_REGISTRATION_SCOPES,
            ],
            // What a client may ASK for at registration. Better Auth fails a
            // registration outright on any requested scope missing from this
            // list, and MCP clients do request `openid` — Codex does — so
            // refusing it here broke registration before the browser opened.
            // Breadth here is safe because the grant is bounded at authorize.
            clientRegistrationAllowedScopes: [...AOMI_SCOPES],
            clientRegistrationRequirePKCE: true,
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            allowPublicClientPrelogin: true,
            accessTokenExpiresIn: 5 * 60,
            refreshTokenReuseInterval: 0,
            customAccessTokenClaims: async ({ user }) => {
              if (!user) throw new Error("oauth_user_required");
              const canonical = await getOrCreateAomiUserForBetterAuthSession({
                betterAuthUserId: user.id,
                email: user.email,
                emailVerified: user.emailVerified,
                name: user.name,
                avatarUrl: user.image,
              });
              return {
                [AOMI_CANONICAL_USER_CLAIM]: canonical.id,
                [AOMI_PRINCIPAL_CLASS_CLAIM]:
                  user.isAnonymous === true ? "guest" : "user",
              };
            },
          }),
        ),
      ),
    ),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
    }),
    compatiblePlugin(
      oauthDeviceAuthorization({
        verificationUri: `${resources.portalOrigin}/oauth/device`,
        schema: {
          deviceCode: {
            modelName: "ba_oauth_device_codes",
            fields: DEVICE_CODE_FIELDS,
          },
        },
      }),
    ),
    aomiProviderAuthPlugin(),
    aomiWidgetOAuthBootstrapPlugin(),
    nextCookies(),
  ],
});
