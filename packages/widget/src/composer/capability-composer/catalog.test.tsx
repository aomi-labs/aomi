import { render, renderHook } from "@testing-library/react";
import type { FC } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentCard,
  AomiPackage,
  AomiPublicPackage,
} from "@aomi-labs/client";
import type { WalletRow } from "@/wallet/composer/wallet-state";

const fixture = vi.hoisted(() => ({
  model: "openai:gpt-6.1-sol",
  agents: [] as AgentCard[],
  packages: [] as AomiPackage[],
  publicPackages: [] as AomiPublicPackage[],
  signedIn: true,
  reloading: false,
}));
vi.mock("@aomi-labs/react", async (original) => ({
  ...(await original<typeof import("@aomi-labs/react")>()),
  useDisplayQuery: (query: { resource: string; enabled?: boolean }) => ({
    data:
      query.enabled === false || fixture.reloading
        ? undefined
        : query.resource === "packages"
          ? fixture.publicPackages
          : { packages: fixture.packages },
  }),
  useControl: () => ({
    state: {
      agentCards: fixture.agents,
      availableModels: ["openai:gpt-6.1-sol"],
    },
    getCurrentThreadControl: () => ({
      model: fixture.model,
      modelMode: "manual",
    }),
  }),
}));
vi.mock("./provider", () => ({
  useCapabilityComposer: () => ({ allowAgentMentions: true }),
}));
vi.mock("@/wallet/network-preferences", () => ({
  useOptionalAomiWalletNetworkPreferences: () => null,
}));
vi.mock("@/wallet/context", () => ({
  useAomiWalletKit: () => ({ wallets: [] }),
}));
vi.mock("@/account/account-overview", () => ({
  useAccountOverview: () =>
    fixture.signedIn ? { user: { user_id: "user-1" } } : null,
}));
vi.mock("@/account/transport", () => ({
  useAomi: () => ({}),
  useShellAomi: () => ({}),
}));
vi.mock("@/library/use-package-catalog", () => ({
  packageCatalogQuery: () => ({ resource: "account-packages" }),
  publicPackageQuery: () => ({ resource: "packages" }),
}));
import {
  packagePickerItems,
  useCapabilityCatalog,
  usePackagePickerItems,
  walletPickerItems,
} from "./catalog";
import { pickerGroups } from "./model";

beforeEach(() => {
  fixture.packages = [];
  fixture.publicPackages = [];
  fixture.signedIn = true;
  fixture.reloading = false;
  fixture.model = "openai:gpt-6.1-sol";
  fixture.agents = [
    {
      agent_id: 42,
      agent: "aomi/partner",
      display_name: "Partner",
      metadata: {
        fundedModelOnly: true,
        sponsoredModelIds: ["openai:gpt-6.1-sol"],
      },
    },
  ];
});
it("disables a funded-only agent after a model switch and restores the matching choice", () => {
  const view = renderHook(useCapabilityCatalog);
  expect(
    view.result.current.find((item) => item.kind === "agent")?.disabled,
  ).toBe(false);
  fixture.model = "anthropic:claude-sonnet-5-5";
  view.rerender();
  expect(
    view.result.current.find((item) => item.kind === "agent")?.disabled,
  ).toBe(true);
  fixture.model = "openai:gpt-6.1-sol";
  view.rerender();
  expect(
    view.result.current.find((item) => item.kind === "agent")?.disabled,
  ).toBe(false);
});
it("allows a user-funded mismatch but treats missing sponsorship metadata as unknown", () => {
  fixture.agents = [
    {
      agent_id: 7,
      agent: "aomi/paid",
      display_name: "Paid",
      metadata: { fundedModelOnly: false, sponsoredModelIds: [] },
    },
    {
      agent_id: 7,
      agent: "aomi/loading",
      display_name: "Loading",
      metadata: {},
    },
  ];
  const { result } = renderHook(useCapabilityCatalog);
  expect(
    result.current.find((item) => item.agentName === "aomi/paid")?.disabled,
  ).toBe(false);
  expect(
    result.current.find((item) => item.agentName === "aomi/loading")?.disabled,
  ).toBe(true);
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

const pkg = (extra: Partial<AomiPackage>): AomiPackage =>
  ({
    package_id: 1,
    id: "aomi/defillama",
    display_name: "DefiLlama",
    description:
      "Token prices, TVL and yields from DefiLlama. Use it for market data.",
    icon_url: null,
    skills: [{ id: "llama-yields", description: "Find the best pool yields" }],
    enabled: true,
    ...extra,
  }) as AomiPackage;

describe("packagePickerItems", () => {
  it("lists each package once, with a one-line description", () => {
    const items = packagePickerItems([pkg({}), pkg({})]);
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
        key: "package:aomi/defillama",
        kind: "package",
        id: "aomi/defillama",
        label: "DefiLlama",
        description: "Token prices, TVL and yields from DefiLlama",
      },
    ]);
  });

  it("hands back the same icon component for an icon_url on every read", () => {
    const iconUrl = "/api/packages/aomi%2Fdefillama/icon";
    const [first] = packagePickerItems([pkg({ icon_url: iconUrl })]);
    const [again] = packagePickerItems([pkg({ icon_url: iconUrl })]);
    expect(again!.Icon).toBe(first!.Icon);
  });

  it("keeps the account's rows while its read reloads under a new key", () => {
    fixture.packages = [pkg({})];
    const { result, rerender } = renderHook(() => usePackagePickerItems());
    expect(result.current.map((item) => item.id)).toEqual(["aomi/defillama"]);
    fixture.reloading = true;
    rerender();
    expect(result.current.map((item) => item.id)).toEqual(["aomi/defillama"]);
  });

  it("drops the last rows once the account changes", () => {
    fixture.packages = [pkg({})];
    const { result, rerender } = renderHook(() => usePackagePickerItems());
    fixture.signedIn = false;
    fixture.reloading = true;
    rerender();
    expect(result.current).toEqual([]);
  });

  it("draws the package's own icon as a mask, else the generic package icon", () => {
    const [own, box] = packagePickerItems([
      pkg({ icon_url: "/api/packages/aomi%2Fdefillama/icon" }),
      pkg({
        package_id: 3,
        id: "acme/box",
        display_name: "Box",
        icon_url: null,
      }),
    ]) as unknown as [
      { Icon: FC<{ className?: string }> },
      { Icon: FC<{ className?: string }> },
    ];
    const mark = render(<own.Icon className="size-3.5" />).container;
    expect(
      mark.querySelector<HTMLElement>("[data-package-icon]")?.dataset
        .packageIcon,
    ).toBe("/api/packages/aomi%2Fdefillama/icon");
    expect(mark.querySelector("img")).toBeNull();
    const generic = render(<box.Icon className="size-3.5" />).container;
    expect(generic.querySelector("svg.lucide-package")).not.toBeNull();
  });

  it.each(["defillama", "aomi/def", "yields", "llama-yields", "pool"])(
    "is found by name, id, description and skill: %s",
    (query) => {
      const groups = pickerGroups(packagePickerItems([pkg({})]), query);
      expect(groups.map((group) => group.label)).toEqual(["Packages"]);
    },
  );

  it("feeds a signed-in picker the Library's packages that are on", () => {
    fixture.packages = [
      pkg({}),
      pkg({
        package_id: 2,
        id: "acme/off",
        display_name: "Off",
        enabled: false,
      }),
    ];
    fixture.publicPackages = [pkg({ id: "acme/public" })];
    const { result } = renderHook(useCapabilityCatalog);
    expect(
      result.current
        .filter((item) => item.kind === "package")
        .map((item) => item.id),
    ).toEqual(["aomi/defillama"]);
  });

  it("feeds a guest's picker the public catalog", () => {
    fixture.signedIn = false;
    fixture.packages = [pkg({})];
    fixture.publicPackages = [
      pkg({ id: "acme/public", display_name: "Public" }),
    ];
    const { result } = renderHook(useCapabilityCatalog);
    expect(
      result.current
        .filter((item) => item.kind === "package")
        .map((item) => item.id),
    ).toEqual(["acme/public"]);
  });
});
