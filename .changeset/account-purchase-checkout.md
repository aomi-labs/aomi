---
"@aomi-labs/client": major
"@aomi-labs/cli": major
"@aomi-labs/react": major
"@aomi-labs/widget": major
"@aomi-labs/deploy": major
---

Cut over to owner-scoped funding events and one Card / USDC checkout for account and builder credits. Remove top-up and purchase APIs, end-user BYOK options and funding headers. Consumers must upgrade with the backend; no compatibility adapters are provided.

Builder grants specify canonical model coverage. App metadata carries fundedModelOnly and sponsoredModelIds inline. Hosting charges debit builder credits, separately from personal Chat credits.

Use the generated CreditBalance and CreditLedger contracts. credits.get() returns only the balance; load history with credits.ledger(). Remove AomiCreditPosition/AomiCreditActivity and export CreditBalance, CreditLedger and CreditLedgerEntry. The shared checkout component is CreditCheckoutDialog.
