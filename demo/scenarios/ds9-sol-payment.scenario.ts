import type { Scenario } from "./types";

/**
 * Scenario 9: pay an invoice in USDC — the most relatable take in the catalog.
 *
 * Everything else we shoot is DeFi; this is money. "Send 150 USDC to this
 * address" is the one prompt a non-crypto partner maps onto their own product
 * instantly (payouts, invoices, remittance), and it exercises the unglamorous
 * plumbing that real payment flows die on:
 *
 * - The RECIPIENT has no USDC token account. A fresh address never does. The
 *   agent has to notice (`AccountNotFound` in simulation, per the global SVM
 *   debug rules) and stage the recipient's ATA creation before the transfer —
 *   the payer funds the rent, which is exactly how real Solana payments work
 *   and exactly the step naive integrations forget.
 * - Exact amounts. A swap take has price tolerance; a payment take does not.
 *   150 means 150.000000, and the verify bounds below are tight enough to
 *   catch a unit slip (USDC is 6 decimals — the classic "sent 150 million"
 *   bug is a 1e6 mistake).
 *
 * The recipient is a deterministic throwaway derived from the fixed seed
 * sha256("aomi-demo-studio-recipient-1") — a real on-curve pubkey that exists
 * nowhere outside this studio, so the fork's view of it is always "brand new
 * wallet". Nobody holds its private key on purpose: money sent there is
 * PROVABLY parked, which is the right property for a demo asset.
 *
 * Verify limitation, stated honestly: the studio's balance assertions read
 * the E2E wallet only, so the on-camera proof is the SENDER's side (USDC
 * 200 → 50, small SOL rent+fee dent). The recipient-side check (150 landed,
 * ATA exists) is one curl in the runbook, not yet a scenario assertion —
 * extend `svm.verify` with an `owner` override if this scenario earns
 * repeat use.
 */
export const scenario: Scenario = {
  id: "ds9-sol-payment",
  title: "Pay 150 USDC to a fresh address",
  chains: [],
  packages: [],
  svm: {
    cluster: "mainnet-beta",
    // 2 SOL: enough for fees + the recipient's ATA rent (~0.002 SOL), small
    // enough that no reasonable agent decision spends visibly from it.
    fund: { sol: "2000000000" },
    tokenAccounts: [
      {
        // 200 USDC, so the payment leaves an obviously-intentional 50 —
        // a balance that reads as "paid the invoice", not "emptied the
        // wallet".
        symbol: "USDC",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "200000000",
      },
    ],
    verify: [
      // Exactly 150 out, so ≤50 remains; atLeast guards against the agent
      // "helpfully" sending more than asked (or a decimals slip sending it
      // all and then some failing).
      {
        kind: "spl",
        symbol: "USDC",
        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        atLeast: "49000000",
        atMost: "51000000",
      },
      // Fees + recipient ATA rent only. If SOL drops below ~1.95 the agent
      // spent something it was not asked to spend.
      { kind: "sol", atLeast: "1950000000" },
    ],
  },
  // Two beats like DS6: the ask, then the approval. The prompt gives the
  // exact address — resolving names is not what this take is about.
  prompts: [
    "Send 150 USDC to 4568cBFkTQKdjgp15cbydPZKR4rAT6Yp7g5pcrSEtMoX — it's an invoice payment.",
    "Yes, approve the payment.",
  ],
  moneyShot:
    "The agent noticing the recipient has no USDC account, creating it as " +
    "part of the payment, and the exact 150.00 landing — plumbing a human " +
    "would have googled for an hour, done as a side effect.",
  timeoutMs: 240_000,
  expectsExecution: true,
};

export default scenario;
