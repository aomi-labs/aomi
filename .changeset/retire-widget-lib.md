---
---

Retire the @aomi-labs/widget-lib compatibility workspace and its build and publication wiring. Consumers must use @aomi-labs/widget and explicitly install the optional SDK peers for their chosen wallet provider. The fresh-install contract now exercises the current widget package; trusted-base consumers are not rewritten. No current widget API or package version changes.
