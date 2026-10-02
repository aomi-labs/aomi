# Issue 695: composer app context

The selected app now appears alongside Model and Safety in the chat composer.
It is a compact, non-interactive logo (generic fallback) and name, with the same
muted text, icon size, spacing, and height as the neighboring controls. There is
no app dropdown, lock badge, or app indicator in the sidebar/header.

These screenshots replace the earlier design. They show the actual local Portal
UI at 1440×900, 390×844, and 320×720. API responses are browser-intercepted test
fixtures: fake account, allowance, app catalog, and existing chat. No real
provider authentication, backend integration, transaction signing, or funds
were used. Google Fonts were blocked in the cloud environment, so these local
captures use fallback fonts. Installed system Chromium was used because the
Playwright CDN download was blocked.

| Scenario | Desktop | Mobile |
| --- | --- | --- |
| Locked Hoodit URL, new chat | [Desktop](desktop-locked-new-chat.png) | [Mobile](mobile-locked-new-chat.png) |
| Locked Hoodit URL, existing chat | [Desktop](desktop-locked-existing-chat.png) | [Mobile](mobile-locked-existing-chat.png) |
| Unlocked URL, generic app icon | [Desktop](desktop-generic-app.png) | [Mobile](mobile-generic-app.png) |

Catalog-unavailable fallbacks at 320px:
[Hoodit](narrow-mobile-hoodit-catalog-unavailable.png),
[Private Agent](narrow-mobile-private-agent-catalog-unavailable.png).
The existing composer row scrolls horizontally when necessary; the generic
app capture scrolls that row to show the full app name. The existing header
controls can overflow at 320px independently of this composer change. A Next
development issue badge may appear in the deliberate catalog-error fixtures.

The six Playwright cases assert non-interactive identity, curated/generic
icons, initial URL state, unavailable catalog fallback, refresh, existing/new
chat, sidebar collapse, unlocked URL context, Auto navigation, and browser Back.
Mobile history navigation waits for the post-refresh session list to load
before opening the sidebar, so it does not race account hydration.

Reproduce in the managed environment from the repository with the cloud wrapper:

```bash
aomi-dev up main --no-build
aomi-dev exec --repo frontend main -- env PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm exec playwright test --project=portal-app-context
```

CI also runs this suite with the existing deterministic guest-browser production
harness (eight total scenarios including its two existing guest tests).
