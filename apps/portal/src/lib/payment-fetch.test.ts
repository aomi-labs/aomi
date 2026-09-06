import { describe, expect, it, vi } from "vitest";

import { createPortalX402Client } from "./payment-fetch";

const CHAT_URL = "https://chat-staging.aomi.dev/v1/agent/chat";

describe("createPortalX402Client", () => {
  it("uses the shared wallet adapter to switch chains and sign", async () => {
    const signTypedData = vi.fn(async () => ({
      signature: `0x${"1".repeat(130)}`,
    }));
    const switchChain = vi.fn(async () => undefined);
    const client = createPortalX402Client({
      identity: {
        status: "connected",
        isConnected: true,
        address: "0x9cb9ec43b1Dcbe0ea37bfA9A99f2c9AAe2eBf2EB",
        chainId: 1,
      },
      signTypedData,
      switchChain,
    });

    expect(client).toBeDefined();
    await client!.createPaymentPayload({
      x402Version: 2,
      resource: { url: CHAT_URL },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:84532",
          asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          amount: "1000",
          payTo: "0x9cb9ec43b1Dcbe0ea37bfA9A99f2c9AAe2eBf2EB",
          maxTimeoutSeconds: 60,
          extra: { name: "USDC", version: "2" },
        },
      ],
    });

    expect(switchChain).toHaveBeenCalledWith(84532);
    expect(signTypedData).toHaveBeenCalledWith({
      typed_data: expect.objectContaining({
        primaryType: "TransferWithAuthorization",
      }),
    });
  });

  it("does not create a client without an EVM signer", () => {
    expect(
      createPortalX402Client({
        identity: { status: "disconnected", isConnected: false },
        signTypedData: undefined,
        switchChain: undefined,
      }),
    ).toBeUndefined();
  });
});
