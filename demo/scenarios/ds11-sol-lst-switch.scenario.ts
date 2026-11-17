import type { Scenario } from "./types";

/**
 * Scenario 11: switch liquid-staking providers in one sentence — the
 * "agent as stake manager" take, and DS7's execution sequel.
 *
 * DS7 ends with the agent comparing LST yields and naming a winner. This
 * scenario is the obvious next line in that conversation: "fine — move me."
 * mSOL → JitoSOL through Sanctum's LST router is a single swap, no
 * unstake-wait-restake loop, which is precisely the point: repositioning a
 * stake used to be a three-day project and is now one approved transaction.
 * Cut DS7 + DS11 together and you get research → decision → execution as one
 * continuous story, which is the whole product pitch in ~60 seconds.
 *
 * Skill surface: `sanctum` is an injected-tool skill (`sanctum_execute_swap`)
 * — Lane 2, the venue builds the transaction blob. That carries the same
 * fork-staleness risk DS6 taught us about with Jupiter: the venue quotes
 * against LIVE mainnet, the mirror is a snapshot, and the gap becomes
 * simulation failures as the snapshot ages. RE-FORK BEFORE SHOOTING THIS —
 * it is the standing runbook rule, and this scenario is why the rule exists.
 *
 * CONFIDENCE: draft. Jupiter and Marinade are take-proven; Sanctum has not
 * been through a phase-0 spike on the mirror. First recording doubles as
 * that spike — if `sanctum_execute_swap` won't replay on Surfpool, the
 * fallback is the same repositioning story via Jupiter (mSOL→JitoSOL routes
 * exist there too), which loses the Sanctum name-drop but keeps the take.
 */
export const scenario: Scenario = {
  id: "ds11-sol-lst-switch",
  title: "Move my stake from Marinade to Jito",
  chains: [],
  packages: [],
  svm: {
    cluster: "mainnet-beta",
    fund: { sol: "1000000000" },
    tokenAccounts: [
      {
        // The position being moved. Same 3.5 mSOL continuity as DS10 — all
        // three takes (DS6 → DS7 → DS11) share one wallet biography.
        symbol: "mSOL",
        mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
        amount: "3500000000",
      },
      {
        // Empty JitoSOL ATA, pre-created. DS6 proved the agent CAN create
        // a missing ATA, so this is not hiding a capability gap — it is
        // keeping the unproven-venue take to ONE unproven thing (Sanctum).
        // Once this scenario passes, delete the fixture and let the agent
        // do it, same graduation DS6 went through.
        symbol: "JitoSOL",
        mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
        amount: "0",
      },
    ],
    verify: [
      // The whole mSOL position moves: 3.5 → ~0.
      {
        kind: "spl",
        symbol: "mSOL",
        mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
        atMost: "100000000",
      },
      // mSOL and JitoSOL trade near parity (both ~1.4 SOL underneath), so
      // 3.5 mSOL should land ~3.4+ JitoSOL; 3.0 tolerates route slippage.
      {
        kind: "spl",
        symbol: "JitoSOL",
        mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
        atLeast: "3000000000",
      },
    ],
  },
  prompts: [
    "Move my entire mSOL position over to JitoSOL — I want Jito's MEV yield.",
    "Yes, make the switch.",
  ],
  moneyShot:
    "One sentence retires a three-day unstake-and-restake project: the whole " +
    "mSOL position swapped into JitoSOL in a single approved transaction, " +
    "with the agent naming the route it chose.",
  // 7 min, same reasoning as ds12: LST routes on a fork snapshot often fail
  // first simulation on a thin venue (first shoot: quote fine at 3.776
  // JitoSOL, sim failed on "Alpha Q", agent correctly excluded it and
  // re-quoted — then hit the 240s clock mid-repair). The repair arc IS the
  // demo; give it film. Sanctum spike verdict from that shoot: quotes work
  // on the mirror, only route thinness bites.
  timeoutMs: 420_000,
  expectsExecution: true,
};

export default scenario;
