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

  it("uses the monochrome MegaETH icon for chain 4326", () => {
    const Icon = getChainIcon(4326);

    expect(Icon).toBeDefined();
    expect(Icon?.name).toBe("MegaETHIcon");
  });

  it("uses the monochrome Arc icon for Arc Testnet", () => {
    const Icon = getChainIcon(5042002);

    expect(Icon).toBeDefined();
    expect(Icon?.name).toBe("ArcIcon");
  });

  it("uses the Arc icon for Mainnet", () => {
    expect(getChainIcon(5042)?.name).toBe("ArcIcon");
  });

  it("uses the monochrome Robinhood icon for chain 4663", () => {
    const Icon = getChainIcon(4663);

    expect(Icon).toBeDefined();
    expect(Icon?.name).toBe("RobinhoodIcon");
  });
});
