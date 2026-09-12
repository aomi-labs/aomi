// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WidgetAuthError } from "@aomi-labs/account/widget-auth";
import type {
  AttestedWallet,
  VerifiedProviderIdentity,
} from "@aomi-labs/account/providers";

import { requireAttestedProviderWallets } from "./exchange";

// This suite drives the real chain — verified identity → attester registry →
// Para's REST wallet list — with only `fetch` and the environment stubbed, so
// it fails if any seam between them is miswired. The route tests mock the
// lookup itself and cover how each outcome maps onto a response.

const PARA_WALLETS_URL = "https://para.test/v1/wallets";
const REST_EVM = "0x1111111111111111111111111111111111111111";
const TOKEN_EVM = "0x2222222222222222222222222222222222222222";
const TOKEN_SOL = "53GfEkka7UYR9KsM6ePWSNfbW678grShT41uZMjXAvoL";

const tokenWallets: AttestedWallet[] = [
  {
    provider: "para",
    providerWalletId: "token-evm",
    family: "evm",
    address: TOKEN_EVM,
    chainScope: null,
  },
  {
    provider: "para",
    providerWalletId: "token-svm",
    family: "svm",
    address: TOKEN_SOL,
    chainScope: null,
  },
];

function identity(
  walletAttestations: AttestedWallet[] = [],
): VerifiedProviderIdentity {
  return {
    provider: "para",
    issuerEnvironment: "para:beta",
    tenantId: "para-project",
    subject: "d5358219-38d3-4650-91a8-e338131d1c5e",
    expiresAt: 1_900_000_300,
    email: { value: "alice@example.com", verified: true },
    loginIdentifier: { type: "email", value: "alice@example.com" },
    walletAttestations,
    metadata: {},
  };
}

function stubParaWallets(
  handler: (url: URL, init?: RequestInit) => Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) =>
    handler(new URL(String(input)), init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function restWalletsResponse(): Response {
  return Response.json({
    data: [
      {
        id: "para-evm",
        address: REST_EVM,
        type: "EVM",
        scheme: "DKLS",
        status: "ready",
      },
    ],
    pagination: { cursor: null, hasMore: false },
  });
}

describe("requireAttestedProviderWallets", () => {
  beforeEach(() => {
    vi.stubEnv("PARA_API_SECRET_KEY", "sk_para_staging");
    vi.stubEnv("PARA_API_BASE_URL", PARA_WALLETS_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("merges the provider API answer with the token's signed attestation", async () => {
    const fetchMock = stubParaWallets((url) => {
      expect(url.origin + url.pathname).toBe(PARA_WALLETS_URL);
      expect(url.searchParams.get("userIdentifier")).toBe("alice@example.com");
      expect(url.searchParams.get("userIdentifierType")).toBe("EMAIL");
      return restWalletsResponse();
    });

    const wallets = await requireAttestedProviderWallets(
      identity(tokenWallets),
    );

    // API rows first, then anything only the token knows about.
    expect(wallets.map((wallet) => wallet.providerWalletId)).toEqual([
      "para-evm",
      "token-evm",
      "token-svm",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "X-API-Key": "sk_para_staging" },
    });
  });

  // Para's `GET /v1/wallets` is indexed by pregen login handle and returns
  // nothing for a wallet the user created through the client SDK — which is
  // every Mini App user. An empty answer there proves nothing, so it must not
  // veto the token's own signed attestation.
  it("still links when the provider API knows nothing about the user", async () => {
    stubParaWallets(() =>
      Response.json({ data: [], pagination: { cursor: null, hasMore: false } }),
    );

    await expect(
      requireAttestedProviderWallets(identity(tokenWallets)),
    ).resolves.toEqual(tokenWallets);
  });

  it("still links when the provider API is down or unconfigured", async () => {
    stubParaWallets(() => new Response("nope", { status: 500 }));
    await expect(
      requireAttestedProviderWallets(identity(tokenWallets)),
    ).resolves.toEqual(tokenWallets);

    vi.stubEnv("PARA_API_SECRET_KEY", "");
    const fetchMock = stubParaWallets(() => Response.json({ data: [] }));
    await expect(
      requireAttestedProviderWallets(identity(tokenWallets)),
    ).resolves.toEqual(tokenWallets);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when neither source knows of an embedded wallet", async () => {
    stubParaWallets(() =>
      Response.json({
        // Not Para-custodied, so it can never back hosted signing.
        data: [
          {
            id: "para-ext",
            address: REST_EVM,
            type: "EVM",
            scheme: "EXTERNAL",
          },
        ],
        pagination: { cursor: null, hasMore: false },
      }),
    );

    const error = await requireAttestedProviderWallets(identity()).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(WidgetAuthError);
    expect(error).toMatchObject({
      code: "provider_hosted_wallet_missing",
      status: 422,
    });
  });
});
