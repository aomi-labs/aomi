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
    expect(getChainIcon(8453)?.name).toBe("BaseIcon");
  });

  it.each([
    [4326, "MegaETHIcon"],
    [5042002, "ArcIcon"],
    [5042, "ArcIcon"],
    [4663, "RobinhoodIcon"],
  ])("maps chain %i to the monochrome %s", (chainId, iconName) => {
    expect(getChainIcon(chainId)?.name).toBe(iconName);
  });
});
