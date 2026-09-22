# Chat activity rail

The selected activity and wallet-impact design now lives in
`apps/shadcn-registry/src/components/activity-sidebar/` and is mounted once by
`assistant-ui/thread.tsx`. The working trace is unchanged. The old
`runtime-tx-handler` composer panel and its query-string preview fixtures are
removed.

## Ownership

- `model.ts`: projects the current turn's skills, task runs and staged transactions
  from durable runtime events. Pending Actions remain visible across turn changes.
  EVM transaction content and SVM blob/instruction content reconcile staged records
  with Action payloads; labels never establish transaction identity.
- `activity-sidebar.tsx`: conditional grouped sections, compact transaction cards,
  chain/skill identity marks and the Stage / Simulate / Commit / Signed strip.
- `wallet-review.tsx`: binds the next pending Action to the existing runtime's
  execution/rejection methods, preserving attempt-state blocking and local errors.
- `transaction-review.tsx`: wallet-impact review, raw details, signing wallets, gas,
  and the explicit Reject / Send to wallet controls.
- `wallet-impact.tsx` and `presentation.tsx`: generic decoded asset/permission
  rendering and exact string-based formatting, shared action icon lookup.

## State semantics

Commit prepares a wallet request; it does not imply signing or broadcast.
Only a real pending Action exposes the review. Failed simulations/guards block
Send to wallet. Empty decoded effects say unavailable, not unchanged. All backend
warnings and full simulation data remain inspectable. Signing errors remain local;
they do not masquerade as a user rejection.

Signed stays neutral before a wallet result, turns blue for a signed result or
submitted transaction leg, and red for rejection. The strip has no separate status
caption or checkmarks. Submission is not presented as chain confirmation; wallet review retains its transaction and simulation details before signing.

The rail scrolls independently beside chat when the chat container is at least
1100px wide and stacks below it on narrower surfaces. New review requests scroll
into view. Cards have quiet grey backgrounds and borders with no hover treatment;
bar labels use a compact fixed line height. Animation respects reduced motion.

## Validation

35 focused activity, wallet-action, working-trace and thread-loading tests; Portal
TypeScript; scoped ESLint; registry and widget package builds. Browser checks used
the production components with isolated fixture callbacks (no real signing),
covering rejection, successful signing and a 390px mobile viewport without
horizontal overflow or page errors. The temporary integration harness was removed.

Balance impact follow-up: effect panels now size to their content. Missing ERC-20 metadata is read from the configured transaction chain, cached by chain/address/RPC and fenced against stale component requests. Existing simulation metadata takes precedence. Missing decimals show an unavailable amount rather than presenting raw units as token quantities. Mobile browser verification resolved Base USDC and rendered 10000 raw units as −0.01 USDC.

Phase motion follow-up: only current-turn active transactions shimmer on the last reached preparation step, moving to Signed during wallet execution. Signed, rejected, failed, and inactive historical work stays still. Reduced motion disables the gradient movement. Transaction-card dropdowns and raw payloads were removed; skill chips share the Library catalog and skillLabel formatter.

## Unified review and stable chat placement

The activity card contains the live review below the current transaction list,
without duplicating transaction rows. The current list is the head pending
Action's exact transactions; other pending requests and staged work are queued
separately. Completed/rejected actions and older staged records remain in
collapsed history. Labels, chains, simulation effects, metadata lookup and
permission/NFT pages continue to use their existing production presenters.

Transactions are open by default and cannot collapse while signing is offered.
Two 84px transaction cards fit before scrolling. The outer shell sizes to its
contents and animates layout with reduced-motion support. The review uses an
inset surface without a separate footer border. Signing payloads and simulation
data remain inspectable. Backend-committed requests with failed simulation
still offer rejection so they cannot deadlock the durable action queue.

At thread-container widths of 1100px or more, the activity rail expands from
zero to 352px in the flex layout. This resizes the entire chat column—including
messages, working trace and composer—as one unit; the left app sidebar is
outside this layout. Exit reverses the width animation. Reduced motion disables
the transition. Below this threshold the Activity / Review transactions button
opens a compact panel, avoiding an unusably narrow chat. Close and Escape
return focus to the toggle.

Validation includes 31 focused tests, including queue advancement, no duplicate
review rows, failed-request rejection, and retaining history across turns.

Browser checks verified narrow panel accessibility at 1366, 800, 390 and 320px
before the final desktop layout revision, with no horizontal overflow and
reachable actions. The final desktop revision is validated for coordinated
chat/composer movement, intermediate animated width, unchanged left-sidebar
width, and restored geometry after closing. Temporary fixtures were removed.

Final spacing uses a 24px right gutter and an 864px maximum chat-column region
beside the rail. A single rail-width progress value drives both widths, avoiding
competing transitions. Browser geometry at 1600px moved chat/composer together
from x=540 through x≈475 to x=456, with the left sidebar remaining 200px.
Approval appearing left both at x=456; closing restored x=540. Embedded review
reveal scrolls only the rail vertically, never the chat's clipping ancestors.

Spacing follow-up: the target chat-column region is now 960px (formerly 864px),
shifting chat and composer up to 48px farther left on wide screens. The message
width, rail position, reduced-motion behavior and shared transition are unchanged.

## Unified newest-first list

Current, queued and past transactions now share one deduplicated list ordered
by event sequence descending (then descending batch index). The header counts
all rows. There is no separate history or queue disclosure. Three 84px cards
plus two 10px gaps fit in the 272px viewport. Conditional, pointer-transparent
fades indicate additional content above/below, respecting reduced motion.
A Show all / Show fewer control below the fades animates between the three-row
viewport and full list height; the containing rail remains scrollable on short
screens. Pending rows use a fine dashed border, accented blue for the active
wallet request. Finalized rows use a solid border. There are no visible Review
labels; mixed lists state the request count near the controls. Signing still applies only to the
head pending Action; history remains static and non-executing.

## Persistence and chronological ordering fixes

Skills and subagent runs are thread-wide; sending a new user message does not
remove them. Stage identifiers include the turn so reused backend IDs cannot
overwrite prior transactions. Matching staged payloads to Actions is likewise
turn-scoped. Sort order preserves each stage's or Action's first sequence,
preventing later completion/rejection revisions from promoting old work.
New top-row IDs reset the viewport to the top; scroll anchoring is disabled.
The Transactions disclosure animates height and opacity, with reduced-motion
support, instead of applying layout scaling to the whole outer card.
