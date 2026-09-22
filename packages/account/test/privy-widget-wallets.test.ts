// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { privyWidgetDescriptor } from "../src/providers/privy";

/**
 * The Telegram Mini App exchange reached `provider_hosted_wallet_missing` for
 * users who plainly had an embedded wallet. Privy's `GET /v1/wallets` does not
 * return every wallet created through the client SDK — which is every Mini App
 * user — and the widget descriptor was discarding the second source: the
 * wallets the identity token itself attests.
 */
describe("privy widget descriptor wallet attestations", () => {
  async function verify(linkedAccounts: unknown[]) {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const spki = await exportSPKI(publicKey);
    vi.stubEnv("PRIVY_APP_ID", "app-under-test");
    vi.stubEnv("PRIVY_IDENTITY_JWT_VERIFICATION_KEY", spki);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: "did:privy:abc",
      linked_accounts: linkedAccounts,
    })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("privy.io")
      .setAudience("app-under-test")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
    return privyWidgetDescriptor.verifyWidgetCredential({
      environment: "PROD",
      providerToken: token,
    });
  }

  it("surfaces the embedded wallet the identity token attests", async () => {
    const identity = await verify([
      {
        type: "wallet",
        chain_type: "ethereum",
        wallet_client_type: "privy",
        address: "0x1111111111111111111111111111111111111111",
        id: "wallet-1",
      },
    ]);
    expect(identity.walletAttestations).toEqual([
      {
        provider: "privy",
        providerWalletId: "wallet-1",
        family: "evm",
        address: "0x1111111111111111111111111111111111111111",
        chainScope: null,
      },
    ]);
  });

  it("drops a merely connected external wallet", async () => {
    // Not Privy-custodied, so it can never back hosted signing. This is the
    // boundary that keeps the token attestation from becoming a client claim.
    const identity = await verify([
      {
        type: "wallet",
        chain_type: "ethereum",
        wallet_client_type: "metamask",
        connector_type: "injected",
        address: "0x2222222222222222222222222222222222222222",
      },
    ]);
    expect(identity.walletAttestations).toEqual([]);
  });
});
