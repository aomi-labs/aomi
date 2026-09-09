import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { AccountSettings } from "./account-settings";
import { seedAccountOverview } from "@portal/lib/account-overview";
import { WalletSignInOptionsContext } from "@aomi-labs/widget-lib";

type FetchCall = { input: string | URL | Request; init?: RequestInit };

const CONNECTED_EVM = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
const PRIVY_SVM = "8xKnQm4kZ7wRt2YbNc5vHj3PqLsDgFxA6eU9QpS1TzWv";

const walletKit = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  connectSocial: vi.fn(async () => undefined),
  canSignFor: undefined as
    | undefined
    | ((chain: string, address: string) => boolean),
  signTypedData: vi.fn(async () => ({ signature: "0xsignature" })),
  signSolanaMessage: vi.fn(async () => ({ signature: "c2ln" })),
  openAccountUI: vi.fn(async () => undefined),
  identity: {
    address: "",
    svmAddress: undefined as string | undefined,
    sessionProvider: undefined as string | undefined,
    embeddedProvider: undefined as string | undefined,
  },
  accounts: [] as Array<{
    id: string;
    family: "evm" | "svm";
    address: string;
    walletName?: string;
    active: boolean;
  }>,
}));

const privyDelegation = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("@aomi-labs/widget-lib", async () => ({
  WalletSignInOptionsContext: (await import("react")).createContext([]),
  useAomiWalletKit: () => walletKit,
  usePrivyDelegation: () => privyDelegation,
}));

vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useOptionalAomiRuntime: () => runtime,
}));

const runtime = vi.hoisted(() => ({
  currentThreadId: "thread-aa-test",
  getUserState: () => ({ evm: { address: "0xLogin", chain_id: 8453 } }),
  setUser: vi.fn(),
}));

/** Canonical `AccountProfile` read model. */
const ACCOUNT = {
  user_accounts: [
    {
      address: { chain: "evm", address: CONNECTED_EVM.toLowerCase() },
      auth_provider: "para",
      is_primary: true,
      provider_managed: false,
    },
    {
      address: { chain: "svm", address: PRIVY_SVM },
      auth_provider: "privy",
      is_primary: false,
      provider_managed: false,
    },
  ],
  signing_policies: [
    {
      address: { chain: "evm", address: CONNECTED_EVM.toLowerCase() },
      mode: "manual",
      authorization_version: 2,
      last_authorized_at: 1_752_000_000,
      last_authorized_by: {
        chain: "evm",
        address: CONNECTED_EVM.toLowerCase(),
      },
    },
    {
      address: { chain: "svm", address: PRIVY_SVM },
      mode: "auto",
      authorization_version: 4,
    },
  ],
  delegated_accounts: [
    {
      id: 41,
      address: { chain: "svm", address: PRIVY_SVM },
      delegation_provider: "privy",
      kind: "session_delegation",
      status: "active",
      created_at: 1_750_000_000,
      updated_at: 1_750_000_000,
      expires_at: 4_000_000_000,
      revoked_at: null,
    },
  ],
};

function installFetchRecorder(overrides: Record<string, () => Response> = {}) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input, init });
      const url = new URL(input.toString(), "https://portal.test");
      const method = init?.method ?? "GET";

      const override = overrides[url.pathname];
      if (override) return override();

      if (url.pathname === "/api/account") return Response.json(ACCOUNT);
      if (url.pathname === "/api/account/authorization/challenge") {
        return Response.json({
          permit: {
            account: "acct-1",
            chain_type: "evm",
            wallet: CONNECTED_EVM,
            mode: "client_auto",
            version: 2,
            expiry: 1_800_000_000,
          },
          typed_data: { primaryType: "AuthorizationPermit" },
        });
      }
      if (url.pathname === "/api/account/authorization/commit") {
        return Response.json({
          address: CONNECTED_EVM,
          chain_type: "evm",
          signing_mode: "client_auto",
          authorization_version: 3,
        });
      }
      if (url.pathname.endsWith("/delegation") && method === "DELETE") {
        return Response.json({ status: "revoked", provider: "privy" });
      }
      return new Response(`Unexpected ${method} ${url.pathname}`, {
        status: 500,
      });
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

/** Render and let the initial account profile load settle inside `act`. */
async function renderAcl(
  connectProvider?: () => Promise<void>,
  provider = "para",
) {
  await act(async () => {
    render(
      <WalletSignInOptionsContext.Provider
        value={
          connectProvider
            ? [
                {
                  id: provider,
                  label: provider,
                  family: "multichain",
                  kind: "social",
                  connect: connectProvider,
                },
              ]
            : []
        }
      >
        <AccountSettings />
      </WalletSignInOptionsContext.Provider>,
    );
  });
}

/** Click and flush the async handler it kicks off. */
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

const findWalletRow = async () =>
  (await screen.findAllByText(/0x71c7…976f/i)).at(-1)!;
const findPrivyRow = async () => (await screen.findAllByText("Privy")).at(-1)!;

const paths = (calls: FetchCall[]) =>
  calls.map(
    (call) => new URL(call.input.toString(), "https://portal.test").pathname,
  );

const bodyOf = (calls: FetchCall[], path: string) => {
  const call = calls.find(
    (c) => new URL(c.input.toString(), "https://portal.test").pathname === path,
  );
  return call?.init?.body ? JSON.parse(String(call.init.body)) : undefined;
};

describe("account ACL wiring", () => {
  beforeEach(() => {
    walletKit.connect.mockClear();
    walletKit.connectSocial.mockClear();
    walletKit.canSignFor = undefined;
    walletKit.identity = {
      address: CONNECTED_EVM,
      svmAddress: undefined,
      sessionProvider: undefined,
      embeddedProvider: undefined,
    };
    walletKit.accounts = [];
    walletKit.signTypedData.mockClear();
    walletKit.signSolanaMessage.mockClear();
    runtime.setUser.mockClear();
    privyDelegation.start.mockReset();
    privyDelegation.start.mockResolvedValue(undefined);
    // The overview store is module-level; seed it so the tab doesn't also
    // depend on /api/account here.
    seedAccountOverview({
      user: { user_id: "acct-1", verified_email: "alice@example.com" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    seedAccountOverview(null);
  });

  it.each(["evm", "svm"])(
    "reviews the unsigned %s payload before requesting a signature",
    async (chain) => {
      walletKit.canSignFor = () => true;
      const { calls } = installFetchRecorder(
        chain === "svm"
          ? {
              "/api/account/authorization/challenge": () =>
                Response.json({
                  permit: {
                    account: "acct-1",
                    chain_type: "svm",
                    wallet: PRIVY_SVM,
                    mode: "client_auto",
                    version: 4,
                    expiry: 1_800_000_000,
                  },
                  message_base64: btoa("Aomi Authorization\nmode: client_auto"),
                }),
            }
          : {},
      );
      await renderAcl();
      await click(
        chain === "evm" ? await findWalletRow() : await findPrivyRow(),
      );
      await click(screen.getByText("Auto-approve"));
      await click(screen.getByText("Review change"));
      const dialog = screen.getByRole("dialog", {
        name: "Confirm signing policy",
      });
      expect(dialog.textContent).toContain(
        chain === "evm" ? CONNECTED_EVM.toLowerCase() : PRIVY_SVM,
      );
      expect(dialog.textContent).toContain("Auto-approve");
      expect(
        within(dialog).getByLabelText("Payload to sign").textContent,
      ).toContain(
        chain === "evm" ? "AuthorizationPermit" : "Aomi Authorization",
      );
      expect(walletKit.signTypedData).not.toHaveBeenCalled();
      expect(walletKit.signSolanaMessage).not.toHaveBeenCalled();
      expect(paths(calls)).toContain("/api/account/authorization/challenge");
      await click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(paths(calls)).not.toContain("/api/account/authorization/commit");
    },
  );

  it("authorizes the exact connected Para wallet without changing the globally selected wallet", async () => {
    walletKit.identity.address = "0x1111111111111111111111111111111111111111";
    walletKit.canSignFor = (chain, address) =>
      chain === "evm" && address === CONNECTED_EVM.toLowerCase();
    installFetchRecorder();
    await renderAcl();
    await click(await findWalletRow());
    await click(screen.getByText("Auto-approve"));
    const authorize = screen.getByText("Review change");
    expect(authorize.hasAttribute("disabled")).toBe(false);
    await click(authorize);
    await click(screen.getByRole("button", { name: "Sign to approve" }));
    expect(walletKit.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: CONNECTED_EVM.toLowerCase(),
      }),
    );
  });

  it("authorizes a connected Para Solana wallet without an extension signer", async () => {
    walletKit.canSignFor = (chain, address) =>
      chain === "svm" && address === PRIVY_SVM;
    walletKit.signSolanaMessage.mockClear();
    const { calls } = installFetchRecorder({
      "/api/account/authorization/challenge": () =>
        Response.json({
          permit: { wallet: PRIVY_SVM },
          message_base64: "cGVybWl0",
        }),
    });
    await renderAcl();
    await click(await findPrivyRow());
    await click(screen.getByText("Auto-approve"));
    const authorize = screen.getByText("Review change");
    expect(authorize.hasAttribute("disabled")).toBe(false);
    await click(authorize);
    await click(screen.getByRole("button", { name: "Sign to approve" }));
    expect(walletKit.signSolanaMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: PRIVY_SVM,
        message: "cGVybWl0",
      }),
    );
    expect(bodyOf(calls, "/api/account/authorization/commit")).toMatchObject({
      signer: PRIVY_SVM,
    });
  });

  it.each(["evm", "svm"])(
    "does not commit a policy when %s signing fails after confirmation",
    async (chain) => {
      walletKit.canSignFor = () => true;
      const sign =
        chain === "evm" ? walletKit.signTypedData : walletKit.signSolanaMessage;
      sign.mockRejectedValueOnce(new Error("Wallet signing cancelled"));
      const { calls } = installFetchRecorder(
        chain === "svm"
          ? {
              "/api/account/authorization/challenge": () =>
                Response.json({
                  permit: { wallet: PRIVY_SVM },
                  message_base64: "cGVybWl0",
                }),
            }
          : {},
      );
      await renderAcl();
      await click(
        chain === "evm" ? await findWalletRow() : await findPrivyRow(),
      );
      await click(screen.getByText("Auto-approve"));
      await click(screen.getByText("Review change"));
      await click(screen.getByRole("button", { name: "Sign to approve" }));
      await screen.findByText("Wallet signing cancelled");
      expect(paths(calls)).not.toContain("/api/account/authorization/commit");
      expect(runtime.setUser).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["evm", "para", "privy"],
    ["svm", "para", "privy"],
    ["evm", "privy", "para"],
    ["svm", "privy", "para"],
  ] as const)(
    "reconnects a linked %s %s wallet through its provider even when %s is selected",
    async (chain, provider, selectedProvider) => {
      walletKit.identity.address = "";
      walletKit.identity.embeddedProvider = selectedProvider;
      const chooseProvider = vi.fn(async () => undefined);
      installFetchRecorder({
        "/api/account": () =>
          Response.json({
            ...ACCOUNT,
            user_accounts: ACCOUNT.user_accounts
              .filter((row) => row.address.chain === chain)
              .map((row) => ({ ...row, auth_provider: provider })),
            signing_policies: ACCOUNT.signing_policies.filter(
              (row) => row.address.chain === chain,
            ),
            delegated_accounts: [],
          }),
      });
      await renderAcl(chooseProvider, provider);
      await click(screen.getByRole("button", { name: "Connect", exact: true }));
      expect(chooseProvider).toHaveBeenCalledOnce();
      expect(walletKit.connect).not.toHaveBeenCalled();
      expect(walletKit.connectSocial).not.toHaveBeenCalled();
    },
  );

  it("loads authorizations and delegated accounts from the canonical account route", async () => {
    const { calls } = installFetchRecorder();

    await renderAcl();

    await findWalletRow();
    expect(paths(calls).filter((path) => path === "/api/account")).toHaveLength(
      1,
    );
    // Privy provenance + live delegation render inside the expanded row.
    await click(await findPrivyRow());
    expect(screen.getByText(/Privy · Session delegation/)).toBeTruthy();
  });

  it("offers server auto from current delegated capability, not the saved mode", async () => {
    const manualWithCapability = {
      ...ACCOUNT,
      signing_policies: ACCOUNT.signing_policies.map((policy) =>
        policy.address.chain === "svm" ? { ...policy, mode: "manual" } : policy,
      ),
    };
    installFetchRecorder({
      "/api/account": () => Response.json(manualWithCapability),
    });

    await renderAcl();
    await click(await findPrivyRow());

    expect(
      screen
        .getByRole("button", { name: /Auto(?!-approve)/ })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("selects the exact existing Auto account as Hosted without another authorization ceremony", async () => {
    runtime.setUser.mockClear();
    const { calls } = installFetchRecorder();
    await renderAcl();
    await click(await findPrivyRow());
    await click(screen.getByRole("button", { name: "Use for this session" }));
    expect(runtime.setUser).toHaveBeenCalledWith(
      expect.objectContaining({
        svm: { address: PRIVY_SVM, broadcaster: "hosted" },
      }),
    );
    expect(paths(calls)).not.toContain("/api/account/authorization/challenge");
  });

  it("selects an agent account without asserting a wallet connection", async () => {
    runtime.setUser.mockClear();
    installFetchRecorder();
    await renderAcl();
    await click(await findPrivyRow());
    await click(screen.getByRole("button", { name: "Use for this session" }));
    const update = runtime.setUser.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(update).toBeDefined();
    expect(update).not.toHaveProperty("connection");
    expect(update.svm).toEqual({ address: PRIVY_SVM, broadcaster: "hosted" });
  });

  it("does not use another provider's delegation as signing capability", async () => {
    const mismatchedDelegation = {
      ...ACCOUNT,
      delegated_accounts: ACCOUNT.delegated_accounts.map((delegation) => ({
        ...delegation,
        delegation_provider: "para",
      })),
    };
    installFetchRecorder({
      "/api/account": () => Response.json(mismatchedDelegation),
    });

    await renderAcl();
    await click(await findPrivyRow());

    expect(screen.getByText("Delegation expired")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Auto(?!-approve)/ }),
    ).toBeNull();
  });

  it("refuses an expired reviewed permit without signing or refreshing it silently", async () => {
    const { calls } = installFetchRecorder({
      "/api/account/authorization/challenge": () =>
        Response.json({
          permit: {
            account: "acct-1",
            chain_type: "evm",
            wallet: CONNECTED_EVM,
            mode: "client_auto",
            version: 2,
            expiry: 1,
          },
          typed_data: { primaryType: "AuthorizationPermit" },
        }),
    });
    await renderAcl();
    await click(await findWalletRow());
    await click(screen.getByText("Auto-approve"));
    await click(screen.getByText("Review change"));
    await click(screen.getByRole("button", { name: "Sign to approve" }));
    expect(screen.getByText(/This authorization expired/)).toBeTruthy();
    expect(walletKit.signTypedData).not.toHaveBeenCalled();
    expect(paths(calls)).not.toContain("/api/account/authorization/commit");
    expect(
      paths(calls).filter(
        (path) => path === "/api/account/authorization/challenge",
      ),
    ).toHaveLength(1);
  });

  it("does not offer approval without a signable payload", async () => {
    const { calls } = installFetchRecorder({
      "/api/account/authorization/challenge": () =>
        Response.json({ permit: {} }),
    });
    await renderAcl();
    await click(await findWalletRow());
    await click(screen.getByText("Auto-approve"));
    await click(screen.getByText("Review change"));
    expect(screen.getByText(/authorization payload is missing/)).toBeTruthy();
    expect(
      screen.queryByRole("dialog", { name: "Confirm signing policy" }),
    ).toBeNull();
    expect(walletKit.signTypedData).not.toHaveBeenCalled();
    expect(paths(calls)).not.toContain("/api/account/authorization/commit");
  });

  it("runs challenge → sign → commit and reloads on a mode change", async () => {
    const { calls } = installFetchRecorder();

    await renderAcl();
    const row = await findWalletRow();

    await click(row);
    await click(await screen.findByText("Auto-approve"));
    await click(await screen.findByText("Review change"));
    const reviewed = JSON.parse(
      screen.getByLabelText("Payload to sign").textContent ?? "",
    );
    expect(walletKit.signTypedData).not.toHaveBeenCalled();
    await click(screen.getByRole("button", { name: "Sign to approve" }));

    await waitFor(() =>
      expect(paths(calls)).toContain("/api/account/authorization/commit"),
    );
    expect(bodyOf(calls, "/api/account/authorization/challenge")).toEqual({
      chain_type: "evm",
      wallet: CONNECTED_EVM.toLowerCase(),
      mode: "client_auto",
    });
    expect(walletKit.signTypedData).toHaveBeenCalledOnce();
    expect(walletKit.signTypedData).toHaveBeenCalledWith(
      expect.objectContaining({ typed_data: reviewed }),
    );
    expect(
      paths(calls).filter((p) => p === "/api/account/authorization/challenge"),
    ).toHaveLength(1);
    expect(bodyOf(calls, "/api/account/authorization/commit")).toMatchObject({
      signature: "0xsignature",
    });
    // Committed state is re-read rather than assumed.
    expect(paths(calls).filter((p) => p === "/api/account")).toHaveLength(2);
  });

  it("choosing Auto selects Hosted for the exact agent account after authorization", async () => {
    runtime.setUser.mockClear();
    let committed = false;
    const { calls } = installFetchRecorder({
      "/api/account": () =>
        Response.json({
          ...ACCOUNT,
          user_accounts: ACCOUNT.user_accounts.map((row) =>
            row.address.chain === "evm"
              ? { ...row, provider_managed: true }
              : row,
          ),
          signing_policies: ACCOUNT.signing_policies.map((row) =>
            row.address.chain === "evm" && committed
              ? { ...row, mode: "auto" }
              : row,
          ),
          delegated_accounts: [
            ...ACCOUNT.delegated_accounts,
            {
              ...ACCOUNT.delegated_accounts[0],
              id: 2,
              address: ACCOUNT.user_accounts[0].address,
              delegation_provider: "para",
              kind: "agent_delegation",
            },
          ],
        }),
      "/api/account/authorization/challenge": () =>
        Response.json({
          permit: { wallet: CONNECTED_EVM, mode: "server_auto" },
          typed_data: { primaryType: "AuthorizationPermit" },
        }),
      "/api/account/authorization/commit": () => {
        committed = true;
        return Response.json({ signing_mode: "server_auto" });
      },
    });
    await renderAcl();
    await click(await findWalletRow());
    await click(screen.getByRole("button", { name: /Auto(?!-approve)/ }));
    await click(screen.getByText("Review change"));
    await click(screen.getByRole("button", { name: "Sign to approve" }));
    expect(bodyOf(calls, "/api/account/authorization/challenge")).toMatchObject(
      { mode: "server_auto" },
    );
    expect(runtime.setUser).toHaveBeenCalledWith(
      expect.objectContaining({
        evm: {
          address: CONNECTED_EVM.toLowerCase(),
          chain_id: 8453,
          broadcaster: "hosted",
        },
      }),
    );
  });

  it("allows a user-controlled Para wallet to accept transactions", async () => {
    const paraAccount = {
      user_accounts: [
        {
          ...ACCOUNT.user_accounts[0],
          auth_provider: "para",
          provider_managed: false,
        },
      ],
      signing_policies: [ACCOUNT.signing_policies[0]],
      delegated_accounts: [],
    };
    const { calls } = installFetchRecorder({
      "/api/account": () => Response.json(paraAccount),
    });

    await renderAcl();
    await click(await findWalletRow());

    const accept = await screen.findByRole("button", {
      name: /^Auto-approve/,
    });
    expect(accept).toHaveProperty("disabled", false);
    expect(
      screen.getByRole("button", { name: /^Auto(?!-approve)/ }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /^Locked/ })).toHaveProperty(
      "disabled",
      false,
    );

    await click(accept);
    const authorize = await screen.findByRole("button", {
      name: "Review change",
    });
    expect(authorize).toHaveProperty("disabled", false);

    await click(authorize);
    await click(screen.getByRole("button", { name: "Sign to approve" }));
    await waitFor(() =>
      expect(paths(calls)).toContain("/api/account/authorization/commit"),
    );
    expect(walletKit.signTypedData).toHaveBeenCalledOnce();
  });

  it("blocks a loosening permit when the wallet itself isn't connected", async () => {
    walletKit.identity = {
      address: "0xSomeOtherWallet",
      svmAddress: undefined,
    };
    const { calls } = installFetchRecorder();

    await renderAcl();
    const row = await findWalletRow();

    await click(row);
    await click(await screen.findByText("Auto-approve"));

    expect(
      screen.getByText("Connect this wallet itself to widen what it may sign."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Review change/ }),
    ).toHaveProperty("disabled", true);
    expect(paths(calls)).not.toContain("/api/account/authorization/challenge");
  });

  it("restates a lost version CAS in words instead of raw JSON", async () => {
    // The backend answers `{"error":"stale_permit"}` with a 409 when another
    // commit won the version race; the raw body must never reach the user.
    installFetchRecorder({
      "/api/account/authorization/commit": () =>
        new Response(JSON.stringify({ error: "stale_permit" }), {
          status: 409,
        }),
    });

    await renderAcl();
    await click(await findWalletRow());
    await click(await screen.findByText("Auto-approve"));
    await click(await screen.findByText("Review change"));
    await click(screen.getByRole("button", { name: "Sign to approve" }));

    expect(
      await screen.findByText(
        "This wallet changed while you were signing. Reload and try again.",
      ),
    ).toBeTruthy();
  });

  it("revokes provider delegated accounts", async () => {
    const { calls } = installFetchRecorder();

    await renderAcl();
    await click(await findPrivyRow());
    await click(await screen.findByText("Revoke"));

    await waitFor(() =>
      expect(paths(calls)).toContain("/api/account/providers/privy/delegation"),
    );
  });

  it("shows unbound connected wallets and runs the bind ceremony", async () => {
    const UNBOUND = "0xUnboundWallet00000000000000000000000001";
    walletKit.accounts = [
      {
        id: "rabby",
        family: "evm",
        address: UNBOUND,
        walletName: "Rabby",
        active: false,
      },
    ];
    const { calls } = installFetchRecorder({
      "/api/account/authorization/challenge": () =>
        Response.json({
          permit: {
            account: "acct-1",
            chain_type: "evm",
            wallet: UNBOUND,
            mode: "bind",
            version: 0,
            expiry: 1_800_000_000,
          },
          typed_data: { primaryType: "AuthorizationPermit" },
        }),
    });

    await renderAcl();
    await click(await screen.findByRole("button", { name: "Activate" }));

    await waitFor(() =>
      expect(paths(calls)).toContain("/api/account/authorization/commit"),
    );
    expect(bodyOf(calls, "/api/account/authorization/challenge")).toEqual({
      chain_type: "evm",
      wallet: UNBOUND,
      mode: "bind",
    });
  });

  it("does not expose obsolete account-wide Para agent provisioning", async () => {
    const paraAccount = {
      user_accounts: [
        {
          ...ACCOUNT.user_accounts[0],
          auth_provider: "para",
          provider_managed: false,
        },
      ],
      signing_policies: [ACCOUNT.signing_policies[0]],
      delegated_accounts: [],
    };
    installFetchRecorder({
      "/api/account": () => Response.json(paraAccount),
    });

    await renderAcl();
    await screen.findByText("0x71c7…976f");
    expect(
      screen.queryByRole("button", { name: "Provision agent wallet" }),
    ).toBeNull();
  });

  it("runs the one-time Privy delegation ceremony before Auto is available", async () => {
    walletKit.identity = {
      address: CONNECTED_EVM,
      svmAddress: undefined,
      sessionProvider: "privy",
      embeddedProvider: "privy",
    };
    const { calls } = installFetchRecorder({
      "/api/delegation/privy/begin": () =>
        Response.json({
          auth_url: "https://portal.test/auth/privy?signer_id=aomi-signer",
          state_token: "signed-state",
        }),
    });

    await renderAcl();
    await click(await screen.findByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(privyDelegation.start).toHaveBeenCalledWith({
        state: "signed-state",
        signerId: "aomi-signer",
      });
    });
    const begin = calls.find(
      (call) =>
        new URL(call.input.toString(), "https://portal.test").pathname ===
        "/api/delegation/privy/begin",
    );
    expect(begin?.init?.headers).toMatchObject({
      "X-Thread-Id": "thread-aa-test",
    });
    expect(JSON.parse(String(begin?.init?.body))).toEqual({
      wallet_family: "evm",
      purpose: "delegate_signing",
    });
  });
});
