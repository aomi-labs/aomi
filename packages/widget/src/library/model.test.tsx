import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toCatalogPackage } from "./packages-catalog";
import { selectionKey, useLibraryEntries } from "./model";
import type { AomiAppDescriptor } from "@aomi-labs/client";
import {
  createDisplayQueryClient,
  displayKey,
  displayKeyPrefix,
  type DisplayScope,
} from "../../../react/src/query/display-cache";
import {
  restoreDisplayData,
  snapshotDisplayData,
} from "../../../react/src/query/display-persistence";
import type { SkillSummary } from "@/composer/capabilities/skill-catalog";

const official = toCatalogPackage({
  name: "dune",
  applicationId: 1,
  metadata: { registered_via: "official_source" },
  featureCatalog: ["research"],
});
const community = toCatalogPackage({
  name: "dune",
  applicationId: 2,
  platform: "community",
  metadata: { registered_via: "activate_apps" },
  featureCatalog: [],
});
const aave: SkillSummary = {
  id: "aave",
  name: "aave",
  description: "Supply and borrow",
  tags: ["lend"],
  featureCatalog: ["lending"],
  chainIds: [],
  injectedTools: [],
};

describe("Library entries", () => {
  const entries = (
    view: "discover" | "apps" | "skills" | "lending",
    query = "",
  ) =>
    renderHook(() =>
      useLibraryEntries({
        catalog: [community, official],
        skills: [aave],
        installedIds: new Set<string>(),
        query,
        view,
      }),
    ).result.current;

  it("uses application identity rather than a duplicate name for row keys", () => {
    const apps = entries("apps").visible;
    expect(apps.map(selectionKey)).toEqual([
      "app:application:1",
      "app:application:2",
    ]);
  });

  it("keeps official items above community items and filters by explicit categories", () => {
    expect(entries("discover").visible.map(selectionKey)).toEqual([
      "skill:aave",
      "app:application:1",
      "app:application:2",
    ]);
    expect(entries("lending").visible.map(selectionKey)).toEqual([
      "skill:aave",
    ]);
  });

  it("restores public app categories and platform descriptions without a warm refetch or private fields", async () => {
    const scope: DisplayScope = {
      backendUrl: "https://backend.example",
      appId: "8",
      account: null,
    };
    const prefix = displayKeyPrefix(scope, "public");
    const key = displayKey(scope, "app-catalog", [""]);
    const original = createDisplayQueryClient();
    original.setQueryData(key, [
      {
        name: "community-lender",
        applicationId: 9,
        isPublic: true,
        platform: "community",
        featureCatalog: ["lending"],
        metadata: { secret: "private" },
        isInstalled: true,
        secretKey: "credential",
        pendingAction: "sign",
      },
    ]);
    const disk = JSON.parse(
      JSON.stringify(snapshotDisplayData(original, prefix)),
    );
    expect(disk.queries[0].data).toEqual([
      {
        name: "community-lender",
        applicationId: 9,
        isPublic: true,
        platform: "community",
        featureCatalog: ["lending"],
      },
    ]);
    const restored = createDisplayQueryClient();
    restoreDisplayData(restored, prefix, disk);
    const fetch = vi.fn(async () => {
      throw new Error("A fresh public catalog should not refetch");
    });
    const rows = await restored.fetchQuery<AomiAppDescriptor[]>({
      queryKey: key,
      staleTime: 30 * 60_000,
      queryFn: fetch,
    });
    expect(fetch).not.toHaveBeenCalled();
    const catalog = rows.map(toCatalogPackage);
    expect(catalog[0].description).toBe("From the community platform.");
    expect(catalog[0].installed).toBe(false);
    const entries = renderHook(() =>
      useLibraryEntries({
        catalog,
        skills: [],
        installedIds: new Set<string>(),
        query: "",
        view: "lending",
      }),
    ).result.current;
    expect(entries.visible.map(selectionKey)).toEqual(["app:application:9"]);
  });

  it("searches the entire Library regardless of the selected tab", () => {
    expect(entries("apps", "aave").visible.map(selectionKey)).toEqual([
      "skill:aave",
    ]);
  });
});
