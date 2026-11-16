// One fixture per builder read, in the wire shape the manager answers
// (briefs/P8-build-api.md). Tests and previews share them.
import type {
  Agent,
  BuilderKey,
  Package,
  Publisher,
  ReleaseList,
} from "./client";

export const publisherFixture: Publisher = {
  publisher: "arixoneth",
  agents: [
    {
      id: "arixoneth/hoodit",
      display_name: "Hoodit",
      status: "active",
      live_config: 3,
    },
    {
      id: "arixoneth/dottie",
      display_name: "Dottie",
      status: "needs_rebuild",
      live_config: 1,
    },
  ],
  packages: [
    {
      id: "arixoneth/trade",
      display_name: "Trade",
      live_release: 5,
      verified: false,
      listed: true,
      active: true,
    },
    {
      id: "arixoneth/token-notes",
      display_name: "Token notes",
      live_release: null,
      verified: false,
      listed: false,
      active: true,
    },
  ],
};

export const agentFixture: Agent = {
  agent: { id: "arixoneth/hoodit", display_name: "Hoodit", status: "active" },
  live: {
    number: 3,
    digest: "sha256:7be02d1c4f0e9a8b",
    source_repo: "arixoneth/hoodit-apps",
    commit: "7be02d1a9c",
    created_at: "2026-11-12T14:02:00Z",
    config: {
      name: "hoodit",
      display_name: "Hoodit",
      voice:
        "You are Hoodit. Sizes are in ETH. Say why a token looks risky before offering to buy.",
      chains: ["robinhood"],
      packages: ["arixoneth/trade", "aomi/swap"],
      model_cost: "person",
      audience: "public",
      allowed_origins: ["hoodit.xyz"],
      wallet_rules: {
        default: "ask",
        families: ["evm"],
        agent: true,
        ask_only: true,
      },
      telegram: {
        show_tool_calls: false,
        group: { enabled: false, tools: [] },
      },
      shortcuts: [{ command: "positions", tool: "trade_get_positions" }],
    },
  },
  channels: [
    {
      id: "4f6c2d1e-8a3b-4c5d-9e7f-0a1b2c3d4e5f",
      kind: "telegram",
      external_bot_id: "hoodit_bot",
      live: true,
    },
    {
      id: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      kind: "widget",
      external_bot_id: "hoodit.xyz",
      live: false,
    },
  ],
};

/** Carried over from an app: its packages have no release yet. */
export const needsRebuildAgentFixture: Agent = {
  agent: {
    id: "arixoneth/dottie",
    display_name: "Dottie",
    status: "needs_rebuild",
  },
  live: null,
  channels: [],
};

export const packageFixture: Package = {
  package: {
    id: "arixoneth/trade",
    display_name: "Trade",
    description: "Buy and sell tokens on Robinhood Chain.",
    listed: true,
    active: true,
  },
  live: {
    release: 5,
    digest: "sha256:a3f9c1e07b52",
    source_repo: "arixoneth/hoodit-apps",
    commit: "bf1cb17e2d",
    created_at: "2026-11-13T20:54:00Z",
    tools: [
      {
        name: "trade_token_info",
        description: "Token data",
        audience: "model",
      },
      {
        name: "trade_stage_buy",
        description: "Propose a buy",
        audience: "model",
      },
    ],
    skills: [
      {
        id: "trade",
        description: "Buy or sell a token with a size in ETH or USDG",
      },
      { id: "positions", description: "Show holdings and profit or loss" },
    ],
    envelope: {
      hash: "sha256:0e1d",
      hosts: ["api.gmgn.ai", "alerts.hoodit.xyz"],
      transactions: [],
      signatures: [],
    },
    guards: true,
    limits: {},
  },
  verified: true,
  slots: [
    {
      name: "GMGN_API_KEY",
      owner: "builder",
      description: "Token data for research and trending",
      required: true,
      status: "set",
    },
    {
      name: "HOODIT_ALERTS_KEY",
      owner: "builder",
      description: "Hoodit alerts service",
      required: false,
      status: "missing",
    },
    {
      name: "ALERTS_PUSH_TOKEN",
      owner: "person",
      description: "Sends a person their own price alerts",
      required: false,
      status: "users_add_their_own",
    },
  ],
};

export const packageReleasesFixture: ReleaseList = {
  live: 5,
  releases: [6, 5, 4].map((number) => ({
    number,
    digest: `sha256:${number}a3f9c1e07b52`,
    size: 1024,
    contract: 1,
    envelope_hash: "sha256:0e1d",
    tools: ["trade_token_info"],
    status: "published",
    created_at: `2026-11-1${number}T20:54:00Z`,
  })),
};

export const agentConfigsFixture: ReleaseList = {
  live: 3,
  releases: [3, 2, 1].map((number) => ({
    number,
    digest: `sha256:${number}7be02d1c4f`,
    created_at: `2026-11-1${number}T14:02:00Z`,
  })),
};

export const keysFixture: { keys: BuilderKey[] } = {
  keys: [
    {
      id: 7,
      prefix: "aomi_key_Zx19d4",
      label: "CI publish key",
      capabilities: [
        "package:publish",
        "package:promote",
        "agent:publish",
        "agent:promote",
      ],
      createdAt: 1761800000,
      lastUsedAt: 1761850000,
      revokedAt: null,
    },
  ],
};
