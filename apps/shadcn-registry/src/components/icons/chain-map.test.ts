import { describe, expect, it } from "vitest";

import { getChainIcon } from "./chain-map";

describe("chain icon map", () => {
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
