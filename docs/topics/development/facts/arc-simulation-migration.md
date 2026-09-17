---
title: Arc simulation response migration
owner: frontend
status: implementation
area: development
---

# Arc simulation response migration

Companion to product-mono's typed Arc simulation contract. The release
candidate starts from frontend main `75877713` and backend main `1aa8f100`
in isolated worktrees.

Client 0.8.0 intentionally migrates `AomiSimulateResponse` to
`{ result: SimReport, fee: AomiSimulateFee | null }`. Reports contain exact
contexts and ordered call execution evidence. `summarizeSimulation` derives the
verdict and successful-step gas. Null executions are skipped; empty reports do
not pass. `SimulationApiError` retains typed partial evidence without converting
an interrupted request into a successful report.

CLI output uses chain-labelled native atomic amounts instead of assuming ETH.
The widget derives current report summaries and retains its previous display
path only for stored tool history. Widget version becomes 2.0.56. Existing
staging and signed-wallet execution types are distinct from simulation evidence;
the latter uses `SimulationCall` and `SimulationExecution` names in the client.

The backend adds derived compatibility fields at the HTTP response boundary
for published clients. The canonical typed report remains the source of truth;
old and new client consumers can read the same response during a backend-first
rollout. This migration does not change host providers, account authority,
signing, or fee policy. The frontend is promoted after backend identity and
contract checks pass.

Focused client and widget tests, client and Portal TypeScript, package builds,
scoped ESLint, formatting, full FE lint/typecheck/1,588 tests, and packed
consumer compatibility pass locally. GitHub CI, staging browser and wallet
paths, and the paired backend release are still gates. These checks do not
imply a browser signing journey or deployed readiness. Nothing has been
published or deployed.
