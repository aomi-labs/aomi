# @aomi-labs/react

## 0.9.2

- Prefer GPT-6.1 Terra for Auto when the backend offers it, preserving manual selections and the existing fallbacks.

## 0.9.1

- Use the backend model catalog without adding app-sponsored supplier routes to the general picker. Recover saved supplier selections as the same manual model in the current catalog, preserving the backend's provider routing and the default-model Auto setting.

## 0.8.5

- Publish under the MIT license, with a `repository` link so npm can show build provenance.

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
