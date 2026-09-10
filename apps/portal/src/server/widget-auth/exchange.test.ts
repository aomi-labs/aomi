// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WidgetAuthError } from "@aomi-labs/account/widget-auth";
import type { VerifiedProviderIdentity } from "@aomi-labs/account/providers";

import { requireAttestedProviderWallets } from "./exchange";

// This suite drives the real chain — descriptor identity → attester registry →
// Para's REST wallet list — with only `fetch` and the environment stubbed, so
// it fails if any seam between them is miswired. The route tests above it mock
// the lookup itself and cover the failure-code mapping.

const PARA_WALLETS_URL = "https://para.test/v1/wallets";
const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "53GfEkka7UYR9KsM6ePWSNfbW678grShT41uZMjXAvoL";

const identity: VerifiedProviderIdentity = {
  provider: "para",
  issuerEnvironment: "para:beta",
  tenantId: "para-project",
  subject: "d5358219-38d3-4650-91a8-e338131d1c5e",
  expiresAt: 1_900_000_300,
  email: { value: "alice@example.com", verified: true },
  loginIdentifier: { type: "email", value: "alice@example.com" },
  walletAttestations: [],
  metadata: {},
};

function stubParaWallets(
  handler: (url: URL, init?: RequestInit) => Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) =>
    handler(new URL(String(input)), init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

  it("attests the EVM and Solana embedded wallets Para holds for the login handle", async () => {
    const fetchMock = stubParaWallets((url) => {
      expect(url.origin + url.pathname).toBe(PARA_WALLETS_URL);
      expect(url.searchParams.get("userIdentifier")).toBe("alice@example.com");
      expect(url.searchParams.get("userIdentifierType")).toBe("EMAIL");
      return Response.json({
        data: [
          {
            id: "para-evm",
            address: EVM,
            type: "EVM",
            scheme: "DKLS",
            status: "ready",
          },
          {
            id: "para-svm",
            address: SOL,
            type: "SOLANA",
            scheme: "ED25519",
            status: "ready",
          },
        ],
        pagination: { cursor: null, hasMore: false },
      });
    });

    await expect(requireAttestedProviderWallets(identity)).resolves.toEqual([
      {
        provider: "para",
        providerWalletId: "para-evm",
        family: "evm",
        address: EVM,
        chainScope: null,
      },
      {
        provider: "para",
        providerWalletId: "para-svm",
        family: "svm",
        address: SOL,
        chainScope: null,
      },
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "X-API-Key": "sk_para_staging" },
    });
  });

  it("reports a Para account with no embedded wallet instead of linking nothing", async () => {
    stubParaWallets(() =>
      Response.json({
        // An imported/external wallet is not Para-custodied: it cannot back
        // hosted signing, so an answer containing only those is "no wallet".
        data: [
          { id: "para-ext", address: EVM, type: "EVM", scheme: "EXTERNAL" },
        ],
        pagination: { cursor: null, hasMore: false },
      }),
    );

    await expect(
      requireAttestedProviderWallets(identity),
    ).rejects.toMatchObject({
      code: "provider_hosted_wallet_missing",
      status: 422,
    });
  });

  it("fails closed, without falling back to token claims, when Para is down", async () => {
    stubParaWallets(() => new Response("nope", { status: 500 }));

    await expect(
      requireAttestedProviderWallets({
        ...identity,
        // A forged wallet claim inside the session JWT must not rescue a failed
        // server-side attestation.
        walletAttestations: [
          {
            provider: "para",
            providerWalletId: "forged",
            family: "evm",
            address: EVM,
            chainScope: null,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "provider_wallets_unavailable",
      status: 503,
    });
  });

  it("fails closed when the deployment has no Para server secret", async () => {
    vi.stubEnv("PARA_API_SECRET_KEY", "");
    const fetchMock = stubParaWallets(() => Response.json({ data: [] }));

    const error = await requireAttestedProviderWallets(identity).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(WidgetAuthError);
    expect(error).toMatchObject({
      code: "provider_wallets_unconfigured",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
