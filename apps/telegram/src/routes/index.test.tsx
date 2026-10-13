// @vitest-environment node
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./index";

const mocks = vi.hoisted(() => ({
  privyAppId: "a123456789012345678901234",
  walletModule: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  get privyAppId() {
    return mocks.privyAppId;
  },
}));
vi.mock("@/features/wallet/wallet-page", () => {
  mocks.walletModule();
  return { default: () => <p>Browser wallet</p> };
});

const Home = Route.options.component!;

describe("Telegram browser wallet boundary", () => {
  beforeEach(() => {
    mocks.privyAppId = "a123456789012345678901234";
    mocks.walletModule.mockClear();
  });

  it("renders the initial ceremony without loading wallet SDKs or claiming a launch", () => {
    const html = renderToString(<Home />);
    expect(html).toContain("Aomi Wallet");
    expect(html).toContain("Setting up your wallet…");
    for (const stage of [
      "Verify Telegram",
      "Link your wallet",
      "Enable server signing",
      "Authorize signing",
    ]) {
      expect(html).toContain(stage);
    }
    expect(html).not.toContain("All set");
    expect(html).not.toContain("Create new wallet");
    expect(mocks.walletModule).not.toHaveBeenCalled();
  });

  it("renders the same readable configuration failure before hydration", () => {
    mocks.privyAppId = "";
    const html = renderToString(<Home />);
    expect(html).toContain("Aomi Wallet");
    expect(html).toContain("This deployment is missing its wallet provider configuration.");
    expect(html).not.toContain("Setting up your wallet");
    expect(mocks.walletModule).not.toHaveBeenCalled();
  });
});
