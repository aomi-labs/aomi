import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CURATED_AGENT_IDS } from "@aomi-labs/client";

import { getAgentIcon } from "./agent-map";
import {
  agentIconBrandAliases,
  agentIconSemanticSources,
  agentIconSources,
} from "@/icons/agents/source-manifest";

describe("getAgentIcon", () => {
  it("covers every curated public agent identity", () => {
    for (const agentScope of CURATED_AGENT_IDS) {
      expect(getAgentIcon(agentScope), agentScope).toBeTypeOf("function");
    }
  });

  it("records provenance or an intentional semantic/shared identity", () => {
    const classified = new Set([
      ...Object.keys(agentIconSources),
      ...Object.keys(agentIconBrandAliases),
      ...Object.keys(agentIconSemanticSources),
    ]);
    expect(
      CURATED_AGENT_IDS.filter((agentScope) => !classified.has(agentScope)),
    ).toEqual([]);
  });

  it("normalizes canonical aliases without exposing object prototype values", () => {
    expect(getAgentIcon("  LI.FI ")).toBe(getAgentIcon("lifi"));
    expect(getAgentIcon("morpho_vaults")).toBe(getAgentIcon("morpho"));
    expect(getAgentIcon("polymarket_rewards")).toBe(getAgentIcon("polymarket"));
    expect(getAgentIcon("constructor")).toBeUndefined();
    expect(getAgentIcon("toString")).toBeUndefined();
    expect(getAgentIcon("")).toBeUndefined();
    expect(getAgentIcon("private-publisher-agent")).toBeUndefined();
  });

  it("renders every curated mark locally through currentColor", () => {
    for (const agentScope of CURATED_AGENT_IDS) {
      const Icon = getAgentIcon(agentScope);
      expect(Icon, agentScope).toBeDefined();
      const markup = renderToStaticMarkup(createElement(Icon!));
      expect(markup, agentScope).toContain("currentColor");
      expect(markup, agentScope).not.toMatch(/\b(?:href|src)="https?:\/\//u);
      expect(markup, agentScope).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
      expect(markup, agentScope).not.toMatch(/\brgb\(/iu);
    }
  });

  it("uses unique SVG resource ids across repeated mark instances", () => {
    const Zora = getAgentIcon("zora")!;
    const Vaults = getAgentIcon("vaultsfyi")!;
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
