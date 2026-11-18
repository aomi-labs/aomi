import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getAgentIcon } from "./agent-map";

const MARKED = ["default", "auto", "orchestrator", "svm", "world-markets"];

describe("getAgentIcon", () => {
  it("marks Aomi's own modes and built-in toolsets in currentColor", () => {
    for (const id of MARKED) {
      const Icon = getAgentIcon(id);
      expect(Icon, id).toBeTypeOf("function");
      const markup = renderToStaticMarkup(createElement(Icon!));
      expect(markup, id).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
      expect(markup, id).not.toMatch(/\b(?:href|src)="https?:\/\//u);
    }
  });

  it("holds no package logo and no prototype key", () => {
    for (const id of ["defillama", "hyperliquid", "zora", "binance", "lifi"]) {
      expect(getAgentIcon(id), id).toBeUndefined();
    }
    expect(getAgentIcon("constructor")).toBeUndefined();
    expect(getAgentIcon("toString")).toBeUndefined();
    expect(getAgentIcon("")).toBeUndefined();
  });
});
