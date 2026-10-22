import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getChainIcon } from "./chain-map";

describe("chain icon map", () => {
  it("shows Base Sepolia's Base mark with a testnet badge instead of ticker text", () => {
    const Icon = getChainIcon(84532);
    expect(Icon).toBeDefined();
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(createElement(Icon!));
    expect(container.querySelector("svg path")).not.toBeNull();
    expect(container.querySelector("svg text")?.textContent).toBe("T");
  });
});
