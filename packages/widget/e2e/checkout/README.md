# Local payment checkout evidence

This harness renders the real credit popup and Stripe Elements against local Payment on port 18085. Its loopback-only Vite proxy uses an explicit development account assertion. It does not prove Portal login or campaign recovery, and must never be deployed.

Start Payment with an isolated migrated database, test Stripe keys, a test webhook signing secret, and an explicit Base Sepolia treasury configuration. Keep all secrets in the process environment or protected local files. Then run from the widget repository:

```sh
PAYMENT_E2E_KEY_FILE=/absolute/backend/testdata/keys/bff-dev.pem aomi-dev exec --repo frontend widget-short-files -- pnpm exec vite --config packages/widget/e2e/checkout/vite.config.ts
```

Open http://127.0.0.1:18080 in a normal Chrome tab. Use Stripe test cards only. Verify the provider record and exactly one ledger entry; a success screen alone is insufficient. Native Chrome rendered the secure fields in this run; browser automation sessions left both this harness and the reference sample fields blank.

`wallet-settlement.ts` submits a real Base Sepolia authorization. `refund-settlement.ts` sends exactly 0.25 test USDC from the separate test treasury back to the payer, and may fund that treasury with 0.00001 test ETH for gas. Both are transaction probes, not read-only tests. Inspect their opt-in variables before use, and never blindly retry after an uncertain result. The refund probe requires `PAYMENT_TEST_REFUND=1`, `BANANA_PRIVATE_KEY`, `TEST_TREASURY_KEY_FILE`, and `TEST_TREASURY_ADDRESS`. `PAYMENT_EVIDENCE_FILE` stores redacted receipts and balance deltas. Payment itself never receives the treasury signing key.

Record an already confirmed refund with Payment's `--record-wallet-refund`, `--refund-transaction`, and `--refund-microusd` operator command. Replaying the same receipt must not create another adjustment.

The backend HTML plan and adjacent payment-checkout-evidence.json distinguish completed sandbox/testnet evidence from remaining release gates. Apple Pay/Link device completion and full Portal/campaign recovery remain separate checks.
