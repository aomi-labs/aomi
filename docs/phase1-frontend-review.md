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
  check independently. Landing also requires runtime configuration proof for its live widget demos. Public config contains no bearer or private env value.
- Alias propagation has a 30-second bound. Unrelated alias drift fails
  immediately. A pending operation is recorded before invoking Vercel. A retry
  after provider acceptance observes current aliases and avoids repeating a
  completed mutation. Regressions cover these paths; live rehearsal is pending.
- Promotion and rollback consume separate public `qa_run_id` and authenticated
  `authenticated_qa_run_id` runs. Both must be successful reviewed-main producers
  for the exact deployment/source/API target and latest workflow attempt; retained
  evidence time must fall inside that attempt and be under24hours old. Portal,
  Build and Telegram also require every mandatory authenticated story, with no
  failed, blocked or duplicate stories. Current partial dedicated-session QA stays
  BLOCKED. Landing retains independent public coverage.
- Source approval and latest required checks are repeated immediately before
  routing. Check pagination prevents an older green result hiding a newer failure.
  Retrying QA uses per-attempt artifacts; producer changes during download block.

The initial Preview E2E failure was a publication delay: the exact Portal SHA
appeared at 07:11:50 UTC after the 07:10:48 deadline. Attempt 2 of run
[39383962206](https://github.com/aomi-labs/aomi/actions/runs/39383962206/attempts/2)
passed at `8a22e29c8d41`. Resolution now observes Portal and Build together and
allows 20 minutes, requiring the newest deployment status to be successful.
It reports queue/publication failures and never substitutes another SHA.

Continuation checks: 67 native contract/resolver tests passed. Portal, Build and
Telegram TypeScript passed after their workspace dependencies were built.
Workflow policy and actionlint passed. Hosted auth/configuration/release/retry
rehearsals are pending. Frontend production currently has only NPM_TOKEN in its
secret inventory; QA staging-qa has no secrets. Local authenticated Vercel reads
were used only to inspect project policy and alias IDs, never to change routing
or copy local credentials into GitHub.

Full shared acceptance and cutover blockers remain in product-mono:
`docs/topics/deployments/facts/phase1-implementation-status.md`.

Continuation credential inventory is scoped: organization secret inheritance could
not be inspected (403). Empty repository/environment inventories do not establish
that inherited credentials are unavailable. Hosted authenticated coverage requires
a dedicated exact-origin account fixture and approved source before any protection
or session credential is sent.
