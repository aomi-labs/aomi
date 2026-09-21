# Transaction review visual contract

This harness renders the production shared `ActivitySidebar`, transaction
cards, and `TransactionReview` with a deterministic Aave Base fixture. The
fixture reproduces the approved 100 USDC approve/supply review: two cards,
USDC −100, aBasUSDC +100.000118, 226,611 gas, the compact signing wallet,
details disclosures, and the original Reject / Send to wallet controls.

`snapshots/pre-extraction-3c54a806` was generated from a detached checkout at
frontend revision `3c54a806d15e24bff68b3bcf08af763f64cd6a23`. The harness
loads the checked-in Geist font, uses a 1355×825 CSS viewport at device scale
1.2 (1626×990 output), disables motion, and checks both themes and a narrow
viewport. The pinned legacy run also checks a failed simulation; the durable
commit run checks a mismatched wallet attempt. The focused sidebar images are
the visual contract. The wide image includes a deliberately minimal fixture
chat context and is not a Portal end-to-end screenshot.

Generate a baseline from the pinned source checkout:

```bash
TRANSACTION_REVIEW_SOURCE_ROOT=/absolute/path/to/3c54a806-checkout \
TRANSACTION_REVIEW_ARTIFACT_DIR=output/playwright/transaction-review-baseline-3c54a806 \
node scripts/test-transaction-review-visuals.mjs
```

Run the candidate production components and require byte-identical output:

```bash
TRANSACTION_REVIEW_EXPECT_DIR=tests/transaction-review-browser/snapshots/pre-extraction-3c54a806 \
node scripts/test-transaction-review-visuals.mjs
```

The current-source run uses only durable commit views: `pendingActions` is
empty, transaction cards bind the commit batch's typed source references to
the original staging events, and the review comes from the persisted commit
snapshot. The runner also clicks the production CTA and verifies it targets
the first commit, then captures a mismatched-attempt recovery state with both
choices disabled. Set `TRANSACTION_REVIEW_FIXTURE_MODE=legacy` only to replay
the extracted original source.

The browser fixture proves production component composition and visual
preservation. Local chain, Commit Service, provider, and receipt behavior are
separate integration evidence.
