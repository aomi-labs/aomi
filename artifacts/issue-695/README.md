# Selected app UI evidence — issue #695

Captured from the real Portal running at `http://localhost:3000` on
`codex/695-selected-app-balance`, based on main
`d5ae182d7b3b8561e06db8ad911f9047b104fb01`.

The browser tests render the actual Portal, shared frame, sidebar, composer,
app icons, and dropdown. **Account identity, allowance, app catalog, app
credentials, and existing chat events are browser-intercepted fixtures.**
No hosted backend, provider login, real account balance, or fund transaction
was verified. All external browser requests are blocked by the fixture.
The account named “UI test account” and its allowance are mock data.

System Chromium (`/usr/bin/chromium`) was used because the Playwright CDN is
blocked in this cloud environment. Google Fonts downloads are also blocked;
these screenshots show the Portal's fallback fonts. App logos are local
reviewed artwork and load normally.

| Scenario | Desktop (1440 × 900) | Mobile (390 × 844) |
| --- | --- | --- |
| URL-selected, locked Hoodit; new chat | [Screenshot](desktop-locked-new-chat.png) | [Screenshot](mobile-locked-new-chat.png) |
| Same locked app; existing chat | [Screenshot](desktop-locked-existing-chat.png) | [Screenshot](mobile-locked-existing-chat.png) |
| Unlocked app selection | [Screenshot](desktop-app-dropdown.png) | [Screenshot](mobile-app-dropdown.png) |
| App without a logo | [Screenshot](desktop-generic-app.png) | [Screenshot](mobile-generic-app.png) |

The tests also verify refresh, new-chat navigation, sidebar collapse, app
selection with hosted application IDs, Auto selection, and browser Back.
Locked controls are informative elements with a lock mark and no dropdown.
The sidebar app control follows the credit allowance; mobile and collapsed
sidebar layouts show the control in the header.

At 320 × 720 the selected [Hoodit](narrow-mobile-hoodit-catalog-unavailable.png)
and [generic app](narrow-mobile-private-agent-catalog-unavailable.png)
indicators remain visible even when the catalog deliberately returns HTTP
503. Long names truncate with their full name in the accessible label and
hover title. The mocked 503 may trigger Next's development error badge.

Reproduce with a running local Portal:

```bash
aomi-dev exec --repo frontend -- env \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  pnpm exec playwright test --project portal-app-context --workers=1
```

Omit the executable override when using Playwright's installed Chromium.
Set `LOCAL_PORTAL_URL` if the local Portal uses another origin. Screenshots
are written to `output/playwright/test-results` before copying here.
