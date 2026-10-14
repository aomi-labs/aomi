import { describe, expect, it } from "vitest";
import {
  normalizeSvmNetworkOptions,
  resolveSelectedSvmNetwork,
} from "./svm-networks";

describe("SVM network resolution", () => {
  it("resolves the selected SVM network RPC endpoint", () => {
    const networks = normalizeSvmNetworkOptions({
      networks: [
        {
          id: "solana-devnet",
          label: "Solana Devnet",
          cluster: "solana:devnet",
          rpcHttpUrl: "https://devnet.example",
          isDefault: true,
        },
        {
          id: "solana-mainnet",
          label: "Solana",
          cluster: "solana:mainnet",
          rpcHttpUrl: "https://mainnet.example",
        },
      ],
    });

    const activeNetwork = resolveSelectedSvmNetwork(networks, "solana-mainnet");

    expect(activeNetwork.cluster).toBe("solana:mainnet");
    expect(activeNetwork.rpcHttpUrl).toBe("https://mainnet.example");
    expect(activeNetwork.id).toBe("solana-mainnet");
    expect(activeNetwork.label).toBe("Solana");
  });
});
