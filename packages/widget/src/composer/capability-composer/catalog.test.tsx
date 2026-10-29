import { render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AomiAppDescriptor } from "@aomi-labs/client";
import type { WalletRow } from "@/wallet/composer/wallet-state";

const fixture = vi.hoisted(() => ({
  model: "openai:gpt-6.1-sol",
  apps: [] as AomiAppDescriptor[],
}));
vi.mock("@aomi-labs/react", async (original) => ({
  ...(await original<typeof import("@aomi-labs/react")>()),
  useControl: () => ({
    state: { appDescriptors: fixture.apps, availableModels: ["openai:gpt-6.1-sol"] },
    getCurrentThreadControl: () => ({ model: fixture.model, modelMode: "manual" }),
  }),
}));
vi.mock("./provider", () => ({ useCapabilityComposer: () => ({ allowAppMentions: true }) }));
vi.mock("@/wallet/network-preferences", () => ({ useOptionalAomiWalletNetworkPreferences: () => null }));
vi.mock("@/composer/capabilities/skill-catalog", () => ({ useSkillCatalog: () => ({ skills: [] }) }));
vi.mock("@/wallet/context", () => ({ useAomiWalletKit: () => ({ wallets: [] }) }));
import { useCapabilityCatalog, walletPickerItems } from "./catalog";

beforeEach(() => {
  fixture.model = "openai:gpt-6.1-sol";
  fixture.apps = [{ name: "partner", applicationId: 42, metadata: { fundedModelOnly: true, sponsoredModelIds: ["openai:gpt-6.1-sol"] } }];
});
it("disables a funded-only app after a model switch and restores the matching choice", () => {
  const view = renderHook(useCapabilityCatalog);
  expect(view.result.current.find((item) => item.kind === "app")?.disabled).toBe(false);
  fixture.model = "anthropic:claude-sonnet-5-5";
  view.rerender();
  expect(view.result.current.find((item) => item.kind === "app")?.disabled).toBe(true);
  fixture.model = "openai:gpt-6.1-sol";
  view.rerender();
  expect(view.result.current.find((item) => item.kind === "app")?.disabled).toBe(false);
});
it("allows a user-funded mismatch but treats missing sponsorship metadata as unknown", () => {
  fixture.apps = [
    { name: "paid", metadata: { fundedModelOnly: false, sponsoredModelIds: [] } },
    { name: "loading" },
  ];
  const { result } = renderHook(useCapabilityCatalog);
  expect(result.current.find((item) => item.appName === "paid")?.disabled).toBe(false);
  expect(result.current.find((item) => item.appName === "loading")?.disabled).toBe(true);
});

const row = (extra: Partial<WalletRow>): WalletRow =>
  ({
    key: "k",
    family: "evm",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    kind: "external",
    linked: true,
    connected: false,
    operating: false,
    state: "ready",
    actions: [],
    ...extra,
  }) as WalletRow;

describe("walletPickerItems", () => {
  it("lists linked wallets by the w_N id the model passes as wallet_id", () => {
    const items = walletPickerItems([
      row({ linkedWalletId: "12", kind: "agent", label: "Trading" }),
      row({
        linkedWalletId: "7",
        family: "svm",
        address: "So11111111111111111111111111111111111111112",
        brand: "Phantom",
        label: "Main",
      }),
      row({ linkedWalletId: "9", brand: "Rabby" }),
    ]);
    expect(
      items.map(({ key, kind, id, label, description }) => ({
        key,
        kind,
        id,
        label,
        description,
      })),
    ).toEqual([
      {
        key: "wallet:w_12",
        kind: "wallet",
        id: "w_12",
        label: "Trading",
        description: "0x1234…5678 · Agent wallet",
      },
      {
        key: "wallet:w_7",
        kind: "wallet",
        id: "w_7",
        label: "Main",
        description: "So1111…1112 · SVM",
      },
      {
        key: "wallet:w_9",
        kind: "wallet",
        id: "w_9",
        label: "Rabby",
        description: "0x1234…5678 · EVM",
      },
    ]);
  });

  it("shows a wallet with an EVM and an SVM address as one row", () => {
    const items = walletPickerItems([
      row({
        key: "s",
        linkedWalletId: "4",
        family: "svm",
        address: "AG6eAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAw18E",
        kind: "embedded",
        provider: "privy",
        brand: "Privy",
      }),
      row({
        key: "e",
        linkedWalletId: "3",
        address: "0xcc83000000000000000000000000000000f38f",
        kind: "embedded",
        provider: "privy",
        brand: "Privy",
      }),
      row({ linkedWalletId: "9", brand: "Rabby" }),
    ]);
    expect(
      items.map(({ key, id, walletIds, label, description }) => ({
        key,
        id,
        walletIds,
        label,
        description,
      })),
    ).toEqual([
      {
        key: "wallet:w_3",
        id: "w_3",
        walletIds: ["w_3", "w_4"],
        label: "Privy",
        description: "0xcc83…f38f · AG6eAA…w18E",
      },
      {
        key: "wallet:w_9",
        id: "w_9",
        walletIds: ["w_9"],
        label: "Rabby",
        description: "0x1234…5678 · EVM",
      },
    ]);
    expect(items[0]!.searchText).toContain("AG6eAA");
  });

  it("keeps two addresses of one family in separate rows", () => {
    expect(
      walletPickerItems([
        row({ linkedWalletId: "1", brand: "MetaMask" }),
        row({ linkedWalletId: "2", brand: "MetaMask" }),
      ]),
    ).toHaveLength(2);
  });

  it("uses the wallet's logo in the text color, else the generic wallet", () => {
    const icon = (extra: Partial<WalletRow>) => {
      const [item] = walletPickerItems([
        row({ linkedWalletId: "1", ...extra }),
      ]);
      const { container } = render(<item.Icon className="size-3.5" />);
      return container.firstElementChild!;
    };
    const rabby = icon({ brand: "Rabby" });
    expect(rabby.tagName).toBe("svg");
    expect((rabby as SVGElement).style.color).toBe("inherit");
    const agent = icon({ kind: "agent", label: "Trading" });
    expect(agent.getAttribute("viewBox")).toBe("0 0 362 362");
    expect(icon({ brand: "Mystery" }).getAttribute("class")).toContain(
      "lucide-wallet",
    );
  });

  it("skips addresses that are not in the account", () => {
    expect(
      walletPickerItems([
        row({ linked: false }),
        row({ linked: true, linkedWalletId: undefined }),
      ]),
    ).toEqual([]);
  });

  it("searches by name and address, not by family", () => {
    const [item] = walletPickerItems([
      row({ linkedWalletId: "12", kind: "agent", label: "Trading" }),
    ]);
    expect(item!.searchText).toBe(
      "Trading 0x1234567890abcdef1234567890abcdef12345678",
    );
  });
});
