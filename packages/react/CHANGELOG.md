# @aomi-labs/react

## 0.8.2

- Prefer GPT-6.1 Sol for new and Auto threads when available, preserving manual selections and existing fallback models.

## 0.8.1

- Project context compaction events into the message runtime.

## 0.8.0

- Add per-account display caching, controlled thread selection, draft preservation and shared query transport.
- Replace guest transports on wallet sign-in without losing unsent drafts; re-admit expired guests once on a fresh conversation without carrying old history or actions.
- Refresh stale profile and ACL display data on focus, and credits after admitted replies settle, with account and operation ownership fences.
- Keep API credentials in memory by default with an explicit scoped session-storage option.
- Expose stable frame runtime integration without restarting chat during wallet-provider initialization.
