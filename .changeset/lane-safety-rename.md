---
"@aomi-labs/client": minor
"@aomi-labs/widget": minor
"@aomi-labs/cli": minor
"@aomi-labs/account": minor
---

Lanes and transaction safety modes use the names people see. `AomiLane` is now `"ask_aomi" | "ask_client" | "instant"` (was `portal` / `here`), and `TransactionSafetyMode` is `"strict" | "balanced" | "yolo"` (was `guarded_only` / `unrestricted`). Responses, storage and command-line input in the old spellings still read correctly through the new `normalizeLane` and `normalizeTransactionSafetyMode`; requests send the new ones, so deploy the backend that accepts both first. Agent wallet addresses carry an optional `operating_address`, which Receive uses for deposits when on-chain limits hold the funds. `account.policies.get` takes an optional `delegate`. In the widget, Swig limits move from the Safety tab to each agent wallet's Manage sheet (Limits), scoped to that wallet, and Yolo gets its own icon instead of sharing the Instant lane's lightning.
