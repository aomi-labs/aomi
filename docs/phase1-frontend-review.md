# Phase 1 frontend review

Publication remains per surface; source eligibility remains tree-wide through
reviewed `release/* -> prod`. The implementation does not change production
routing or automatically assign domains. Backend soak never consumes this QA.

Cecilia review:

- Main ancestry, approved merge tree, Production Promotion Policy and aggregate
  CI are checked for the exact deployment source.
- All four projects must retain `autoAssignCustomDomains=false`; authenticated
  read-only provider observations confirmed this on 2026-10-20.
- Candidate client method/path/auth and conservative request/response requirements
  are checked against both current Backend and Manager OpenAPI providers.
  Rollback uses the selected older candidate's requirements. Staging Manager
  still returns 404; requirements were not weakened.
- `/api/release` binds the actual BFF origin and compiled browser API base to
  the immutable deployment hostname and source SHA. Telegram additionally
  verifies its Portal BFF's upstream. QA and routing operations repeat this
  check independently. Public config contains no bearer or private env value.
- Alias propagation has a 30-second bound. Unrelated alias drift fails
  immediately. A pending operation is recorded before invoking Vercel. A retry
  after provider acceptance observes current aliases and avoids repeating a
  completed mutation. Regressions cover these paths; live rehearsal is pending.
- Public browser smoke never passes authenticated journeys. Portal, Build and
  Telegram remain blocked until an authenticated deployment-bound suite exists
  and runs. Landing may use its independent public coverage.

The initial Preview E2E failure was a publication delay: the exact Portal SHA
appeared at 07:11:50 UTC after the 07:10:48 deadline. Attempt 2 of run
[39383962206](https://github.com/aomi-labs/aomi/actions/runs/39383962206/attempts/2)
passed at `8a22e29c8d41`. Resolution now observes Portal and Build together and
allows 20 minutes, requiring the newest deployment status to be successful.
It reports queue/publication failures and never substitutes another SHA.

Continuation checks: 65 native contract/resolver tests passed. Portal, Build and
Telegram TypeScript passed after their workspace dependencies were built.
Workflow policy and actionlint passed. Hosted auth/configuration/release/retry
rehearsals are pending. Frontend production currently has only NPM_TOKEN in its
secret inventory; QA staging-qa has no secrets. Local authenticated Vercel reads
were used only to inspect project policy and alias IDs, never to change routing
or copy local credentials into GitHub.

Full shared acceptance and cutover blockers remain in product-mono:
`docs/topics/deployments/facts/phase1-implementation-status.md`.
