import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SVM_ADDRESS = "BindCardWallet1111111111111111111111111111";
const MESSAGE = "Aomi Authorization v1\nbind card payload";
const signature = Uint8Array.from([1, 2, 3, 4]);
const signSolanaMessage = vi.fn(async (payload: { message?: string }) => {
  expect(payload.message).toBe(Buffer.from(MESSAGE).toString("base64"));
  return { signature: Buffer.from(signature).toString("base64") };
});

vi.mock("@aomi-labs/widget-lib", () => ({
  useAomiWalletKit: () => ({
    identity: {
      svmAddress: SVM_ADDRESS,
      svmCluster: "solana:devnet",
      svmCapabilities: { canSignMessage: true },
      // Legacy bind is embedded-transport-only (2026-07-17); the hook's
      // requiresBinding gate short-circuits bind() for external wallets.
      svmTransport: "embedded",
    },
    signSolanaMessage,
  }),
  Button: (props: React.ComponentProps<"button">) => <button {...props} />,
}));

const policies: Array<{
  address: { chain: "svm"; address: string };
  mode: string;
}> = [];
const posts: Array<{ path: string; body: unknown }> = [];

vi.mock("@portal/lib/settings-api", () => ({
  accountScopedFetch: async (path: string, options?: RequestInit) => {
    if (path === "/api/account") {
      return { signing_policies: [...policies] };
    }
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    posts.push({ path, body });
    if (path.endsWith("/challenge")) {
      return {
        permit: {
          account: "acct-1",
          chain_type: "svm",
          wallet: SVM_ADDRESS,
          mode: "bind",
          version: 0,
          expiry: 4102444800,
        },
        message_base64: Buffer.from(MESSAGE).toString("base64"),
      };
    }
    policies.push({
      address: { chain: "svm", address: SVM_ADDRESS },
      mode: "manual",
    });
    return {
      address: SVM_ADDRESS,
      chain_type: "svm",
      signing_mode: "human_sync",
      authorization_version: 0,
    };
  },
}));

import { SvmWalletBinding } from "./svm-wallet-binding";

describe("SvmWalletBinding", () => {
  beforeEach(() => {
    policies.length = 0;
    posts.length = 0;
    signSolanaMessage.mockClear();
  });

  it("binds with the exact challenge and reflects manual signing", async () => {
    render(<SvmWalletBinding />);
    fireEvent.click(await screen.findByRole("button", { name: "Bind wallet" }));
    await screen.findByText(/signing mode: manual/i);
    expect(signSolanaMessage).toHaveBeenCalledOnce();
    expect(
      posts.find((post) => post.path.endsWith("/commit"))?.body,
    ).toMatchObject({
      permit: { wallet: SVM_ADDRESS, mode: "bind" },
      signature: Buffer.from(signature).toString("base64"),
    });
  });

  it("shows an existing binding without an action", async () => {
    policies.push({
      address: { chain: "svm", address: SVM_ADDRESS },
      mode: "manual",
    });
    render(<SvmWalletBinding />);
    await waitFor(() =>
      expect(screen.getByText(/signing mode: manual/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Bind wallet" })).toBeNull();
  });
});
