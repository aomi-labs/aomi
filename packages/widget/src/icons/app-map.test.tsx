import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CURATED_APP_IDS } from "@/lib/apps/app-identity";

import { getAppIcon } from "./app-map";
import {
  appIconBrandAliases,
  appIconSemanticSources,
  appIconSources,
} from "./apps/source-manifest";

describe("getAppIcon", () => {
  it("covers every curated public app identity", () => {
    for (const appId of CURATED_APP_IDS) {
      expect(getAppIcon(appId), appId).toBeTypeOf("function");
    }
  });

  it("records provenance or an intentional semantic/shared identity", () => {
    const classified = new Set([
      ...Object.keys(appIconSources),
      ...Object.keys(appIconBrandAliases),
      ...Object.keys(appIconSemanticSources),
    ]);
    expect(CURATED_APP_IDS.filter((appId) => !classified.has(appId))).toEqual(
      [],
    );
  });

  it("normalizes canonical aliases without exposing object prototype values", () => {
    expect(getAppIcon("  LI.FI ")).toBe(getAppIcon("lifi"));
    expect(getAppIcon("morpho_vaults")).toBe(getAppIcon("morpho"));
    expect(getAppIcon("polymarket_rewards")).toBe(getAppIcon("polymarket"));
    expect(getAppIcon("constructor")).toBeUndefined();
    expect(getAppIcon("toString")).toBeUndefined();
    expect(getAppIcon("")).toBeUndefined();
    expect(getAppIcon("private-publisher-app")).toBeUndefined();
  });

  it("renders every curated mark locally through currentColor", () => {
    for (const appId of CURATED_APP_IDS) {
      const Icon = getAppIcon(appId);
      expect(Icon, appId).toBeDefined();
      const markup = renderToStaticMarkup(
        createElement(Icon!),
      );
      expect(markup, appId).toContain("currentColor");
      expect(markup, appId).not.toMatch(/\b(?:href|src)="https?:\/\//u);
      expect(markup, appId).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
      expect(markup, appId).not.toMatch(/\brgb\(/iu);
    }
  });

  it("uses unique SVG resource ids across repeated mark instances", () => {
    const Zora = getAppIcon("zora")!;
    const Vaults = getAppIcon("vaultsfyi")!;
    const markup = renderToStaticMarkup(
      <>
        <Zora />
        <Zora />
        <Vaults />
        <Vaults />
      </>,
    );
    const ids = Array.from(
      markup.matchAll(/\bid="([^"]+)"/gu),
      (match) => match[1],
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
