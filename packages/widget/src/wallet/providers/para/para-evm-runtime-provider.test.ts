import { beforeEach, describe, expect, it, vi } from "vitest";
import { base } from "wagmi/chains";
import type ParaWeb from "@getpara/react-sdk";

const mocks = vi.hoisted(() => {
  const connector = Object.assign(() => ({}), { id: "para" });
  return {
    connector,
    paraConnector: vi.fn(() => connector),
    createAomiEvmConfig: vi.fn((config: { connectors?: unknown[] }) => ({
      connectors: config.connectors ?? [],
    })),
  };
});

vi.mock("@getpara/wagmi-v2-connector", () => ({
  paraConnector: mocks.paraConnector,
}));

vi.mock("./para-auth", () => ({
  useSafeParaClient: vi.fn(() => null),
}));

vi.mock("../../catalog/evm-connector-catalog", () => ({
  createAomiEvmConfig: mocks.createAomiEvmConfig,
}));

import { createAomiParaEvmConfig } from "./para-evm-runtime-provider";

describe("Para EVM runtime", () => {
  beforeEach(() => {
    mocks.paraConnector.mockClear();
    mocks.createAomiEvmConfig.mockClear();
  });

  it("adds the Para connector to the config used for transaction signing", () => {
    createAomiParaEvmConfig({ chains: [base], wallets: [] }, {} as ParaWeb);

    expect(mocks.paraConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        chains: [base],
        disableModal: true,
      }),
    );
    expect(mocks.createAomiEvmConfig).toHaveBeenCalledWith(
      expect.objectContaining({ connectors: [mocks.connector] }),
    );
  });

  it("does not expose a disconnected Para connector without a Para client", () => {
    createAomiParaEvmConfig({ chains: [base], wallets: [] }, null);

    expect(mocks.paraConnector).not.toHaveBeenCalled();
    expect(mocks.createAomiEvmConfig).toHaveBeenCalledWith(
      expect.objectContaining({ connectors: [] }),
    );
  });
});
