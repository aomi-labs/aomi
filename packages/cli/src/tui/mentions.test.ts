import { describe, expect, it, vi } from "vitest";
import type { Aomi, AomiPackage } from "@aomi-labs/client";
import { MentionAutocomplete, mentionCatalog } from "./mentions";

const row = (extra: Partial<AomiPackage>) =>
  ({
    package_id: 1,
    id: "aomi/defillama",
    display_name: "DefiLlama",
    description: "Token prices and TVL",
    skills: [],
    enabled: true,
    ...extra,
  }) as AomiPackage;

function client(
  list: (options?: { threadId?: string }) => Promise<unknown>,
  mode: "guest" | "account" = "account",
  publicPackages: unknown = { packages: [] },
) {
  return {
    auth: { mode },
    raw: {
      getPublicCatalog: async (kind: string) =>
        kind === "packages" ? publicPackages : { skills: [] },
    },
    account: { packages: { list }, wallets: { list: async () => [] } },
  } as unknown as Aomi;
}

describe("mentionCatalog", () => {
  it("lists the thread's packages that are on", async () => {
    const list = vi.fn(async () => ({
      agent: { id: "aomi/main", display_name: "Aomi" },
      packages: [
        row({}),
        row({ package_id: 2, id: "acme/off", enabled: false }),
      ],
    }));
    const items = await mentionCatalog(client(list), "thread-1");
    expect(list).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(
      items.filter((item) => item.kind === "package").map((item) => item.id),
    ).toEqual(["aomi/defillama"]);
  });

  it("reads aomi/main's packages before the thread is stored", async () => {
    const list = vi.fn(async (options?: { threadId?: string }) => {
      if (options?.threadId) throw new Error("session_not_found");
      return {
        agent: { id: "aomi/main", display_name: "Aomi" },
        packages: [row({})],
      };
    });
    const items = await mentionCatalog(client(list), "new-thread");
    expect(items.some((item) => item.id === "aomi/defillama")).toBe(true);
  });

  it("gives a guest the public catalog, never the account read", async () => {
    const list = vi.fn();
    const items = await mentionCatalog(
      client(list, "guest", {
        packages: [{ id: "aomi/jupiter", display_name: "Jupiter", skills: [] }],
      }),
      "thread-1",
    );
    expect(list).not.toHaveBeenCalled();
    expect(
      items.filter((item) => item.kind === "package").map((item) => item.id),
    ).toEqual(["aomi/jupiter"]);
  });

  it("offers a package under Packages and sends its id on the hint line", async () => {
    const items = [
      {
        kind: "package" as const,
        id: "aomi/defillama",
        label: "DefiLlama",
        description: "Token prices and TVL",
        searchText: "aomi/defillama",
      },
    ];
    const mentions = new MentionAutocomplete([], () => items);
    const found = await mentions.getSuggestions(["price @defi"], 0, 11, {
      signal: new AbortController().signal,
    });
    expect(found?.items).toEqual([
      {
        value: "package:aomi/defillama",
        label: "@DefiLlama",
        description: "Package · Token prices and TVL",
      },
    ]);
    const applied = mentions.applyCompletion(
      ["price @defi"],
      0,
      11,
      found!.items[0]!,
      found!.prefix,
    );
    expect(applied.lines).toEqual(["price @DefiLlama "]);
    expect(mentions.hint("price @DefiLlama of ETH")).toContain(
      "Preferred package ids: aomi/defillama.",
    );
  });
});
