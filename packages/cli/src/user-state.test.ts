import { describe, expect, it } from "vitest";

import {
  buildCliUserState,
  walletSnapshotFromUserState,
} from "../../src/cli/user-state";

describe("buildCliUserState", () => {
  it("builds an EVM-only block from an explicit address", () => {
    expect(buildCliUserState("0xabc", 8453)).toEqual({
      connection: { is_connected: true },
      evm: { address: "0xabc", chain_id: 8453 },
      ext: { client_type: "ts_cli" },
    });
  });

  it("builds a Solana-only block from an explicit SVM address", () => {
    expect(
      buildCliUserState(undefined, undefined, {
        svmAddress: "6ihjJiFMrn8VM1HLX8EMqAt8Ym8JxZCqxBai2bYHviZG",
        svmCluster: "solana:mainnet",
      }),
    ).toEqual({
      connection: { is_connected: true },
      svm: {
        address: "6ihjJiFMrn8VM1HLX8EMqAt8Ym8JxZCqxBai2bYHviZG",
        cluster: "solana:mainnet",
      },
      ext: { client_type: "ts_cli" },
    });
  });

  it("builds independent EVM and SVM wallet blocks", () => {
    expect(
      buildCliUserState("0xabc", 8453, {
        svmAddress: "6ihjJiFMrn8VM1HLX8EMqAt8Ym8JxZCqxBai2bYHviZG",
        svmCluster: "solana:devnet",
      }),
    ).toMatchObject({
      connection: { is_connected: true },
      evm: { address: "0xabc", chain_id: 8453 },
      svm: {
        address: "6ihjJiFMrn8VM1HLX8EMqAt8Ym8JxZCqxBai2bYHviZG",
        cluster: "solana:devnet",
      },
    });
  });

  it("never injects a cluster the caller did not resolve", () => {
    expect(
      buildCliUserState(undefined, undefined, {
        svmAddress: "6ihjJiFMrn8VM1HLX8EMqAt8Ym8JxZCqxBai2bYHviZG",
      }).svm,
    ).toEqual({
      address: "6ihjJiFMrn8VM1HLX8EMqAt8Ym8JxZCqxBai2bYHviZG",
    });
  });

  it("emits no wallet blocks and no connection without addresses", () => {
    expect(buildCliUserState()).toEqual({ ext: { client_type: "ts_cli" } });
  });

  it("never projects pending execution or AA authority into UserState", () => {
    const state = buildCliUserState("0xabc", 8453);
    expect(state).not.toHaveProperty("pending");
    expect(state.evm).not.toHaveProperty("aa");
  });
});

describe("walletSnapshotFromUserState", () => {
  it("reads wallet identity only", () => {
    const snapshot = walletSnapshotFromUserState({
      connection: { is_connected: true },
      evm: { address: "0xabc", chain_id: 8453 },
    });

    expect(snapshot).toEqual({ publicKey: "0xabc", chainId: 8453 });
  });
});
