import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getSkillIcon, JupiterSkillIcon, normalizeSkillId } from "./index";
import {
  skillIconFallbacks,
  skillIconGenericAliases,
  skillIconSources,
} from "./source-manifest";

const BUILT_IN_SKILL_IDS = [
  "aave",
  "across",
  "aerodrome",
  "arbitrum_bridge",
  "avantis",
  "base_native",
  "cctp",
  "common_erc20",
  "compound",
  "convex",
  "curve",
  "debridge",
  "drift",
  "dummy",
  "eigenlayer",
  "etherfi",
  "jupiter",
  "kamino",
  "kelp",
  "krexa",
  "lido",
  "lifi_swap",
  "mantle_staked_eth",
  "marinade",
  "meteora",
  "morpho",
  "oneinch",
  "openbook",
  "optimism_native",
  "pendle",
  "raydium",
  "renzo",
  "robinhood_stocks",
  "rocket_pool",
  "sanctum",
  "squads",
  "stargate",
  "sushiswap",
  "uniswap",
  "yearn",
  "zksync_era_native",
  "zora",
] as const;

describe("skill icon mapping", () => {
  it("normalizes wire IDs without changing their identity", () => {
    expect(normalizeSkillId("  Rocket-Pool ")).toBe("rocket_pool");
    expect(getSkillIcon("  Rocket-Pool ")).toBeDefined();
  });

  it("returns official marks for mapped built-in skills", () => {
    const mappedIds = Object.keys(skillIconSources);

    for (const skillId of mappedIds) {
      expect(getSkillIcon(skillId), skillId).toBeDefined();
    }
    expect(getSkillIcon("jupiter")).toBe(JupiterSkillIcon);
  });

  it("provides semantic marks for the token and developer test skills", () => {
    expect(getSkillIcon("dummy")).toBeDefined();
    expect(getSkillIcon("common_erc20")).toBeDefined();
    expect(getSkillIcon("common-erc20")).toBeDefined();
  });

  it("leaves unsupported and dynamic IDs to the caller fallback", () => {
    for (const skillId of skillIconFallbacks) {
      expect(getSkillIcon(skillId)).toBeUndefined();
    }
    expect(getSkillIcon("custom-user-skill")).toBeUndefined();
    expect(getSkillIcon(null)).toBeUndefined();
    expect(getSkillIcon(undefined)).toBeUndefined();
  });

  it("renders every built-in identity locally without clipping its CSS size", () => {
    for (const id of BUILT_IN_SKILL_IDS) {
      const Icon = getSkillIcon(id);
      expect(Icon, id).toBeDefined();
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(
        createElement(Icon!, { width: 20, height: 20 }),
      );
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("width"), id).toBe("20");
      expect(svg.getAttribute("height"), id).toBe("20");
      expect(svg.getAttribute("viewBox"), id).toBeTruthy();
      expect(svg.querySelector("path, circle, rect, image"), id).not.toBeNull();
      expect(svg.querySelector("script, foreignObject, style"), id).toBeNull();
      for (const image of svg.querySelectorAll("image")) {
        expect(image.getAttribute("href"), id).toMatch(
          /^data:image\/webp;base64,/,
        );
      }
    }
  });

  it("keeps repeated Zora gradient references independent", () => {
    const Icon = getSkillIcon("zora")!;
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      createElement("div", null, createElement(Icon), createElement(Icon)),
    );
    const ids = [...container.querySelectorAll("radialGradient")].map(
      (gradient) => gradient.id,
    );
    expect(new Set(ids).size).toBe(2);
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg.querySelector("path")?.getAttribute("fill")).toBe(
        `url(#${svg.querySelector("radialGradient")?.id})`,
      );
    }
  });

  it("renders Krexa through independent monochrome alpha masks", () => {
    const Icon = getSkillIcon("krexa")!;
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      createElement("div", null, createElement(Icon), createElement(Icon)),
    );
    const masks = [...container.querySelectorAll("mask")];
    expect(new Set(masks.map((mask) => mask.id)).size).toBe(2);
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg.querySelector("mask")?.style.maskType).toBe("alpha");
      expect(svg.querySelector("rect")?.getAttribute("fill")).toBe(
        "currentColor",
      );
      expect(svg.querySelector("rect")?.getAttribute("mask")).toBe(
        `url(#${svg.querySelector("mask")?.id})`,
      );
      expect(svg.querySelectorAll("defs image")).toHaveLength(1);
      expect(svg.querySelectorAll(":scope > image")).toHaveLength(0);
    }
  });

  it("partitions every built-in ID exactly once in the icon manifest", () => {
    const manifestIds = [
      ...Object.keys(skillIconSources),
      ...Object.keys(skillIconGenericAliases),
      ...skillIconFallbacks,
    ];

    expect(new Set(manifestIds).size).toBe(BUILT_IN_SKILL_IDS.length);
    expect(new Set(manifestIds)).toEqual(new Set(BUILT_IN_SKILL_IDS));
    expect(manifestIds).toHaveLength(42);
  });
});
