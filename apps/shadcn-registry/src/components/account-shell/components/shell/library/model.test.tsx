import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { toCatalogPackage } from "../packages-catalog";
import { selectionKey, useLibraryEntries } from "./model";
import type { SkillSummary } from "../../../../../lib/capabilities/skill-catalog";

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

  it("searches the entire Library regardless of the selected tab", () => {
    expect(entries("apps", "aave").visible.map(selectionKey)).toEqual([
      "skill:aave",
    ]);
  });
});
