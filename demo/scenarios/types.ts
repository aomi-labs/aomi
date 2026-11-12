/**
 * A demo scenario: one prompt, one recorded master, three usable cuts.
 *
 * The studio records a single high-fidelity take per scenario and emits markers
 * alongside it. Short-form cuts (social loop, docs loop) are derived from those
 * markers, never re-shot — re-shooting is how demo libraries drift out of sync
 * with each other and with the product.
 */

export type Scenario = {
  /** Stable slug; names the output directory. */
  id: string;
  /** One line, for the catalog and the video description. */
  title: string;
  /**
   * Id from product-mono's story catalog
   * (docs/topics/testing-automation/facts/aomi-transact-automation.md), when
   * this scenario rides on an already-passing test path. Scenarios with a story
   * id are known to work; ones without need their path proven first.
   */
  story?: string;
  /** EVM chain ids this scenario touches; each is reforked before the take. */
  chains: number[];
  /**
   * SDK apps this scenario needs, by name (`zerox`, `polymarket-rewards`, …).
   * Empty means the scenario runs on built-in protocol skills alone — staking
   * via Lido / Rocket Pool / Ether.fi needs no app at all.
   *
   * These are resolved from a LOCAL aomi-sdk build, not from a GitHub release.
   * That is the point: it lets us record an integration that has not shipped
   * yet — write the app, record the demo, no release cycle. It also keeps the
   * backend from reconciling the whole production catalog, which is what makes
   * a local backend unusable today.
   */
  apps: string[];
  /**
   * Chain actors (mock off-chain counterparties from product-mono's
   * `aomi-actors` crate — `across` is the first) to run for the take.
   *
   * The recorder starts `aomi test-env actors up` after reset + funding and
   * stops it after the take. This is what makes cross-chain scenarios
   * completable on forks: the actor watches the source fork and lands the
   * real follow-up transaction (e.g. an Across `fillRelay`) on the
   * destination fork, with a few seconds of fill delay for on-camera
   * suspense. A scenario with actors is expected to advance EVERY chain it
   * declares, not just one.
   */
  actors?: string[];
  /**
   * Conversation turns, typed in order; each waits for the agent's response to
   * complete before the next is sent. One entry = a single-shot demo. Most
   * execution demos need two: the ask, then the go-ahead — a real agent
   * proposes before it spends, and the approval beat is part of the story.
   */
  prompts: string[];
  /**
   * The frame that sells it. Free text — it tells whoever cuts the video what
   * they are looking for, and it tells us whether the scenario has a point.
   */
  moneyShot: string;
  /**
   * ERC-20 balances to seed on the demo wallet before the take.
   *
   * `anvil_setBalance` only moves native ETH, so tokens are seeded by
   * impersonating a holder and transferring — for USDC the obvious holder is
   * one of the faucet wallets `test-env evm up` already funds. Runs after the
   * chain reset, like ETH funding, because a reset reforks and wipes balances.
   */
  erc20?: Array<{
    /** For logs only. */
    symbol: string;
    /** Token contract. */
    token: string;
    /** An address that already holds enough; impersonated, never signed for. */
    holder: string;
    /** Base-units amount (USDC has 6 decimals, not 18). */
    amount: string;
  }>;
  /**
   * Solana leg. Present = the take runs against the Surfpool mirror
   * (`aomi test-env svm up --cluster <cluster>`), reset before recording.
   * A scenario may be SVM-only (`chains: []`) or span both VMs.
   */
  svm?: {
    cluster: "mainnet-beta" | "devnet";
    /**
     * Native SOL the wallet starts each take with, in raw lamports. Written
     * after reset via `surfnet_setAccount`, because reset does NOT re-apply
     * the startup airdrop (see svm-env.ts `resetSvm`). Declare this on any
     * scenario that spends SOL, or take N+1 inherits take N's leftovers.
     */
    fund?: { sol: string };
    /**
     * Token accounts fabricated after reset via `surfnet_setTokenAccount`
     * (raw base units). `amount: "0"` creates an EMPTY ATA — required for
     * first-time destinations while the svm_stage_ix skill manifests still
     * block ATA creation.
     */
    tokenAccounts?: Array<{ symbol: string; mint: string; amount: string }>;
    /**
     * Post-take chain-state proof. Surfpool mints slots on a clock, so slot
     * advance proves nothing — execution is verified by balances or not at
     * all. Amounts are raw base units (lamports / SPL raw).
     */
    verify?: Array<
      | { kind: "sol"; atLeast?: string; atMost?: string }
      | {
          kind: "spl";
          symbol: string;
          mint: string;
          atLeast?: string;
          atMost?: string;
        }
    >;
  };
  /**
   * Upper bound for the agent's turn. Not a sleep: the recorder waits on the
   * streaming indicator and only uses this to fail a hung take.
   */
  timeoutMs?: number;
  /**
   * True when the scenario is supposed to put a transaction on chain. The
   * recorder then fails the take if the fork mined no block — which is how we
   * catch "the agent explained what it would do" masquerading as a demo.
   */
  expectsExecution?: boolean;
};

/** Beats worth timestamping so cuts can be derived from one master. */
export type MarkerName =
  | "page-ready"
  | "prompt-typed"
  | "prompt-submitted"
  | "trace-appeared"
  | "response-complete";

export type Marker = {
  name: MarkerName;
  /** Milliseconds from the start of the video, not wall-clock. */
  offsetMs: number;
};

export type CaptureResult = {
  scenarioId: string;
  videoPath: string;
  markers: Marker[];
  /** Text of the final assistant message, for eyeballing whether it's usable. */
  finalMessage: string;
};
