# Aomi widget

```tsx
import { AomiWidget } from "@aomi-labs/widget";
import "@aomi-labs/widget/styles.css";

<AomiWidget applicationId="YOUR_HOSTED_APP_ID" />;
```

The default API is `https://chat.aomi.dev`. Set `baseUrl` explicitly for a local
backend or another deployment. `applicationId` identifies the hosted app; the
optional `routing` configuration separately selects Auto or Direct execution.
The default auth mode is `browser_wallet`, so guest chat starts without an
embedded wallet SDK. Embeds do not provision backend AA wallets.

## Optional embedded wallets

Install only the provider you use. The `auth` prop loads that SDK on demand;
nothing else needs importing:

```tsx
import { AomiWidget, privyAuth } from "@aomi-labs/widget";

<AomiWidget
  applicationId="YOUR_HOSTED_APP_ID"
  auth={privyAuth({ appId: "YOUR_PRIVY_APP_ID" })}
/>;
```

Privy uses its SDK and its Solana and smart-wallet feature peers:

```sh
npm install @privy-io/react-auth@2.25.0 @privy-io/wagmi@1.0.6 \
  @solana/kit@^2.3.0 @solana/spl-token@^0.4.9 \
  @solana-program/token@^0.5.1 @solana-program/system@^0.7.0 \
  permissionless@^0.2.47 @abstract-foundation/agw-client@^1.0.0
```

These dependencies are only needed when choosing Privy. Its SDK imports the
feature peers during bundling even when the host uses only basic wallets.

Para requires `@getpara/react-sdk` and `@getpara/wagmi-v2-connector` and uses
`paraAuth({ apiKey, environment })`; `environment` defaults to `"PROD"`. A
missing provider package or an invalid prop shows a message inside the widget
instead of failing the host page.
Credentials and RPC configuration are explicit host inputs. The package does
not read Next.js environment variables. SDK loading, provider retries and
provider changes preserve the mounted chat, composer draft and thread state.
`preloadWalletProvider("privy" | "para")` can warm the selected SDK on focus or
hover without changing account state.

The legacy `auth.kind` objects, `apiUrl`, the `./aomi-widget`, `./aomi-frame`,
`./hooks/*` and `./components/*` subpaths, the raw `./themes/*.css` source and
every main-entry export other than the widget, its types and the auth helpers
are deprecated and removed in 4.0. Hosts that compose `AomiFrame` import it from
`@aomi-labs/widget/frame` and the wallet kit, account UI and primitives from
`@aomi-labs/widget/host-composition`.

## Host composition and isolation

`AomiFrame` uses the same chat and wallet UI as the standalone widget. Hosts can
pass `products` explicitly; embeds omit the product switcher by default.
Controlled hosts may pass `threadId` and `onThreadChange`. Changing the selected
thread does not recreate the frame shell.

Compiled `styles.css` scopes reset, theme, utilities, animations and overlay
content to each `.aomi-widget` root. `theme="light" | "dark" | "system"`
(default `"system"`) chooses a theme per instance; composed frames take
`className="dark"` or `"light"`.

Browser preferences are namespaced by backend and hosted app, with account
scope where available. Existing preference keys migrate once to the first
scope that reads them and are then removed. API keys stay in memory by default;
first-party hosts may explicitly select scoped session storage through
`AomiFrame`'s `apiKeyPersistence="session"`. Old plaintext local-storage API
keys are removed when read and are never written back.
