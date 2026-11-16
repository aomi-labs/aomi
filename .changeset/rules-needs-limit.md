---
"@aomi-labs/client": minor
"@aomi-labs/widget": patch
---

Each `enforcement` entry in a wallet's rules carries `needs_limit`: the asset that needs a daily limit before the provider can hold the rules on chain, or null. In the widget's Rules section, a provider that is off for want of a limit now offers Add limit, which opens the limit form on that token, and no longer asks for a wallet to be connected first.
