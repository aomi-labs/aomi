# Existing explorer links

Run `node scripts/test-onchain-links-browser.mjs` through the managed
`aomi-dev exec --repo frontend --` workflow. On the cloud image, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` for that command.

The local Vite/Playwright fixture uses the shared production `MarkdownText`
component and assistant-ui runtime. It asserts exact destinations for ten
existing links, Solscan/EVM styling and accessibility, code/duplicate/reference
link preservation, ordinary fallback for unsupported URLs, and no links in bare
text or fenced code. Browser requests to external hosts are blocked.

Outputs are written to `output/playwright/onchain-links/`. `preview.png` is a
captured rendering for PR review, not a visual regression baseline. This is
component rendering evidence; it does not prove ledger inclusion or a complete
Portal/backend journey.

Verified Solscan paths come from its [account page](https://solscan.io/account/11111111111111111111111111111111),
[Wrapped SOL page](https://solscan.io/token/So11111111111111111111111111111111111111112),
and [TX MAP documentation](https://docs.solscan.io/transaction-details/transaction-details/tx-map).
