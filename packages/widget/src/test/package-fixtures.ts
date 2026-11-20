import type { AomiPackage, AomiPackageCatalog } from "@aomi-labs/client";

/** A Library row as `GET /api/account/packages` sends it. */
export function packageRow(overrides: Partial<AomiPackage> = {}): AomiPackage {
  return {
    package_id: 9003,
    id: "aomi/jupiter",
    display_name: "Jupiter",
    description: "Swap tokens on Solana at the best route.",
    icon_url: null,
    chains: ["solana"],
    tags: ["dex"],
    tool_count: 4,
    skills: [{ id: "jupiter", description: "Quote and swap on Jupiter." }],
    live: { release: 3, digest: "sha256:aa" },
    verified: true,
    listed: true,
    agent_listed: false,
    choice: null,
    enabled: true,
    reason: "verified_default",
    envelope: {
      hash: "sha256:env1",
      hosts: ["api.jup.ag"],
      transactions: ["svm"],
      signatures: [],
    },
    slots: [],
    tools: [],
    guards: [],
    ...overrides,
  };
}

export const AGENT_LISTED = packageRow({
  package_id: 9001,
  id: "aomi/aave",
  display_name: "Aave",
  description: "Lend, borrow and repay on Aave.",
  skills: [{ id: "aave", description: "Supply and borrow." }],
  chains: ["ethereum", "base", "arbitrum"],
  tags: ["lending"],
  agent_listed: true,
  reason: "agent_listed",
});

export const VERIFIED = packageRow();

export const NOT_VERIFIED = packageRow({
  package_id: 9010,
  id: "arixoneth/hoodit-trade",
  display_name: "Hoodit trade",
  description: "Buy and sell tokens on Robinhood Chain.",
  skills: [{ id: "trade", description: "Buy or sell a token." }],
  chains: ["robinhood"],
  tags: [],
  verified: false,
  enabled: false,
  reason: "off_by_default",
  envelope: {
    hash: "sha256:env9",
    hosts: ["api.gmgn.ai"],
    transactions: ["evm"],
    signatures: [
      {
        kind: "evm-typed-data",
        domains: [{ chain_id: 8453, verifying_contract: "0xabc" }],
        primary_types: ["Order"],
      },
    ],
  },
});

export const NEEDS_KEY = packageRow({
  package_id: 9020,
  id: "aomi/polymarket",
  display_name: "Polymarket",
  description: "Prediction market prices, positions and bets.",
  skills: [{ id: "markets", description: "Read markets." }],
  chains: ["polygon"],
  tags: ["prediction"],
  slots: [
    {
      name: "POLY_API_KEY",
      owner: "person",
      description: "Your Polymarket key",
      required: true,
      status: "missing",
    },
    {
      name: "POLY_BUILDER",
      owner: "builder",
      description: "",
      required: true,
      status: "ready",
    },
  ],
});

export function catalog(packages: AomiPackage[]): AomiPackageCatalog {
  return { agent: { id: "aomi/main", display_name: "Aomi" }, packages };
}
