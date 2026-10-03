# Edit/Rerun pending-control evidence

Source under test: frontend `184674548c9e7712a3cbff544a1ff79fdc201d14` on `codex/chat-branch-capabilities` (based on main `0a67ad3b535f9239a616b4d8128d148a50b72d02`). Chromium 151.0.7922.173. Both desktop (1440×1000) and touch/mobile (390×844) passed.

The runner uses actual shared AomiFrame/Thread, SDK and React runtime source in Vite. Identity, REST responses, model answers and the HTTP SSE upstream are controlled fixtures. These screenshots prove UI behavior, not fresh real price lookup or candidate backend integration. The full local Portal build remains unavailable after the earlier managed-memory failures; the screenshots carry that label.

New assertions retain the clicked Rerun/Edit control visibly, disable it, set `aria-busy`, and expose a status announcement while admission is delayed. Repeated native clicks produce one start request. The remaining cases cover edit replacement, rerun after edit, streaming, thinking/tool-phase Stop, repeated Stop, early interruption, failed Stop/retry, uncertain admission and bounded terminal acknowledgments/races. All 38 screenshots and the [machine-readable browser report](browser-report.json) are retained here.

| Pending control | Desktop | Mobile |
| --- | --- | --- |
| Rerun | [Screenshot](desktop-rerun-pending.png) | [Screenshot](mobile-rerun-pending.png) |
| Edit-submit | [Screenshot](desktop-edit-pending.png) | [Screenshot](mobile-edit-pending.png) |
| Stop | [Screenshot](desktop-stopping.png) | [Screenshot](mobile-stopping.png) |

Reproduce from the frontend repository using the configured cloud environment:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium CHAT_CONTROLS_ARTIFACTS=artifacts/branch-capabilities aomi-dev exec --repo frontend -- node scripts/test-chat-turn-controls.mjs --harness
```

Frontend draft: https://github.com/aomi-labs/aomi/pull/700. Backend draft: https://github.com/aomi-labs/product-mono/pull/1234.

Hosted reproduction on the old #699 preview proved ETH→BTC Edit and Rerun did not make a fresh tool lookup. The #700 frontend preview is Vercel deployment `Eyv6gXub5MHKRrQimDVMNsYTBKBt` at the tested source SHA; it still needs a backend runtime running #1234 for live-tool verification. Backend PR CI builds without deployment credentials, and the supported deployment pipeline accepts main SHAs. No supported pre-merge backend preview route was found. Candidate live verification therefore remains blocked by current deployment authorization and local missing provider credentials/proxy CONNECT 403; this report makes no live-price success claim.
