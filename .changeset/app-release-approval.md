---
"@aomi-labs/account": minor
"@aomi-labs/deploy": minor
---

Build CLI sessions carry a new `approve` scope, used by `aomi-build approve` to approve a promoted deployment's exact app libraries. A promote result's `status` can now be `awaiting_review`: the release waits for an Aomi approver and the live release keeps serving.
