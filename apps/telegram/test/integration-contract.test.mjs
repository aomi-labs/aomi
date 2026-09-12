import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readWorkspace = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("Custom Telegram auth resolves the canonical Aomi account", async () => {
  const [providers, canonicalAccount, customAuth] = await Promise.all([
    read("src/app/providers.tsx"),
    read("src/hooks/use-canonical-account.ts"),
    read("src/hooks/use-telegram-custom-auth.ts"),
  ]);

  // Aomi verifies Telegram itself; Privy receives only the resulting Custom
  // JWT. Email is the explicit existing-wallet recovery/link method.
  assert.match(providers, /loginMethods: \["email"\]/);
  assert.match(providers, /createOnLogin: "users-without-wallets"/);
  assert.match(customAuth, /useSubscribeToJwtAuthWithFlag/);
  assert.match(customAuth, /useLinkJwtAccount/);
  assert.match(customAuth, /disableSignup: true/);
  assert.match(customAuth, /confirmExistingWallet/);
  assert.match(customAuth, /telegram_custom_auth_timeout/);
  assert.match(customAuth, /\/api\/auth\/widget\/telegram\/custom-auth/);
  assert.match(canonicalAccount, /getIdentityToken/);
  assert.match(canonicalAccount, /custom_user_id/);
  assert.match(canonicalAccount, /provider: "privy"/);
  assert.match(canonicalAccount, /linkedEmbeddedWalletAddress/);
  assert.match(canonicalAccount, /privy_embedded_wallet_timeout/);
  assert.match(canonicalAccount, /telegram_privy_exchange_timeout/);
  assert.match(canonicalAccount, /createAccountSessionProvider/);
  assert.match(canonicalAccount, /\/api\/auth\/widget\/telegram\/exchange/);
  assert.match(canonicalAccount, /\/v1\/account/);
});

test("Telegram Mini Apps rely on Privy's seamless OAuth login", async () => {
  const page = await read("src/app/page.tsx");

  // Privy completes Telegram Mini App login as the provider initializes.
  // Calling the experimental headless hook in parallel can leave the page in
  // its initial signing state when that second auth flow rejects.
  assert.doesNotMatch(page, /useLoginWithTelegram|void login\(\)/);
});

test("Telegram launches are verified before a production wallet flow", async () => {
  const [client, route, verifier] = await Promise.all([
    read("src/lib/telegram.ts"),
    read("src/app/api/telegram/launch/route.ts"),
    readWorkspace("packages/account/src/telegram.ts"),
  ]);

  assert.match(client, /webApp\.initData/);
  assert.match(client, /bot_id/);
  assert.match(client, /\/api\/telegram\/launch/);
  assert.match(route, /verifyTelegramInitData/);
  assert.match(verifier, /verifySignature/);
  assert.match(verifier, /WebAppData/);
  assert.doesNotMatch(verifier, /BOT_TOKEN|bot token/i);
});

test("the Mini App only links a wallet and signs permission permits", async () => {
  const [page, permission] = await Promise.all([
    read("src/app/page.tsx"),
    read("src/hooks/use-permission-control.ts"),
  ]);

  assert.match(page, /useCanonicalAccount/);
  assert.match(page, /usePermissionControl/);
  assert.match(page, /Sign permission/);
  assert.match(permission, /authorizationChallenge/);
  assert.match(permission, /authorizationCommit/);
  assert.match(permission, /signTypedData/);
  assert.match(permission, /getEthereumProvider/);
  assert.doesNotMatch(
    page,
    /ActionHandler|sendTransaction|Sign All|transaction bundle/i,
  );
  assert.doesNotMatch(permission, /waitForTransactionReceipt|sendTransaction/);
});

test("the provider SDK and the app share one React Query context", async () => {
  const nextConfig = await read("next.config.ts");

  assert.match(nextConfig, /"@tanstack\/react-query"/);
  assert.match(nextConfig, /appNodeModules/);
});

test("the legacy relay and multi-page wallet are absent", async () => {
  const [packageJson, page] = await Promise.all([
    read("package.json"),
    read("src/app/page.tsx"),
  ]);

  // Privy is the wallet provider now; the relay-era stack must stay out.
  assert.doesNotMatch(packageJson, /walletconnect|wagmi|getpara/i);
  assert.doesNotMatch(page, /\/api\/operation|Swap assets|Review & sign/i);
});

test("permission signing targets one exact wallet and mode", async () => {
  const [launch, permission] = await Promise.all([
    read("src/lib/telegram.ts"),
    read("src/hooks/use-permission-control.ts"),
  ]);

  assert.match(launch, /permission_chain/);
  assert.match(launch, /permission_wallet/);
  assert.match(launch, /permission_mode/);
  assert.match(permission, /wallet: target\.wallet/);
  assert.match(permission, /mode: target\.mode/);
});

test("a restored Privy session survives the launch and settles the phase", async () => {
  const customAuth = await read("src/hooks/use-telegram-custom-auth.ts");

  // Privy's JWT sync logs the user out whenever `getExternalJwt` resolves
  // undefined, and it runs before the bootstrap can mint one. Keeping it
  // disabled until a Custom JWT exists is what lets a restored session live
  // through a launch instead of paying for a fresh login every time.
  assert.match(customAuth, /enabled: customJwt !== null/);
  // Readiness is a string comparison against the session's own Custom JWT
  // subject, never a Privy flow status: a status level flaps under the SDK's
  // re-renders and would tear down the account session provider with it.
  assert.match(
    customAuth,
    /readyForExchange = phase !== "error" && sessionMatchesTelegram/,
  );
  assert.match(customAuth, /privyCustomSubject === customSubject/);
  // A bound Telegram user whose Privy session already carries that identity
  // must skip the mint-and-re-authenticate round trip entirely.
  assert.match(customAuth, /sessionRef\.current\.privyCustomSubject ===/);
  // The `authenticating` timeout has to see a settled session, or it fires
  // 15s into a working session and turns it into an error.
  assert.match(
    customAuth,
    /phase !== "authenticating" \|\| sessionMatchesTelegram/,
  );
});

test("an authorization commit cannot reach a disposed session", async () => {
  const permission = await read("src/hooks/use-permission-control.ts");

  // The wallet signature sits between challenge and commit. Resolving the
  // provider per call, rather than capturing it, keeps the commit on whatever
  // session is current when it runs.
  assert.match(permission, /providerRef\.current/);
  assert.doesNotMatch(permission, /await input\.provider!\(\)/);
});

test("Privy's own components own login and account management", async () => {
  const [customAuth, page, providers] = await Promise.all([
    read("src/hooks/use-telegram-custom-auth.ts"),
    read("src/app/page.tsx"),
    read("src/app/providers.tsx"),
  ]);

  // Email entry and the OTP belong to Privy's modal, not to a hand-rolled
  // form. The signup block is the property that has to survive the swap:
  // this path may only reach a wallet that already exists.
  assert.match(customAuth, /useLogin/);
  assert.match(customAuth, /disableSignup: true/);
  assert.doesNotMatch(customAuth, /useLoginWithEmail|sendCode|loginWithCode/);
  assert.doesNotMatch(page, /type="email"|one-time-code|Verification code/);
  // Account and wallet management is Privy's `UserPill`.
  assert.match(page, /UserPill/);
  assert.match(page, /@privy-io\/react-auth\/ui/);
  // Aomi still owns the Telegram binding confirmation itself.
  assert.match(page, /Confirm and link Telegram/);
  // The modal follows Telegram's palette instead of arriving as a white sheet.
  assert.match(providers, /appearance/);
  assert.match(providers, /colorScheme === "light"/);
});

test("a failure is never painted over by a progress message", async () => {
  const [page, canonicalAccount] = await Promise.all([
    read("src/app/page.tsx"),
    read("src/hooks/use-canonical-account.ts"),
  ]);

  // Errors are evaluated before any progress message, so the code the person
  // needs to read survives to the screen.
  const errorBranch = page.indexOf('telegramAuth.phase === "error"');
  const loadingBranch = page.indexOf('account.status === "loading"');
  assert.ok(errorBranch > 0 && loadingBranch > 0);
  assert.ok(
    errorBranch < loadingBranch,
    "the auth error branch must precede the account loading branch",
  );
  // The canonical-account lookup is bounded like the exchange above it.
  assert.match(canonicalAccount, /canonical_account_timeout/);
});

test("the account exchange does not wait on Privy's connected-wallet list", async () => {
  const canonicalAccount = await read("src/hooks/use-canonical-account.ts");

  // `useWallets().ready` waits on the wallet-proxy iframe, the external
  // connectors, and — once the account owns an embedded wallet — on that wallet
  // being actively connected. Telegram's webview restricts third-party iframe
  // storage, so that connection routinely never lands and `ready` stays false
  // forever on an account whose wallet exists and works. The exchange only ever
  // needs the wallet to EXIST: it sends an identity token, and the portal
  // attests the hosted wallet through Privy's server API. Reading
  // `linkedAccounts` answers existence with none of that machinery.
  // Asserted against the import list rather than the file, so the explanation
  // above may keep naming the hook it is warning about.
  const privyImport = canonicalAccount.slice(
    canonicalAccount.indexOf("import {"),
    canonicalAccount.indexOf('} from "@privy-io/react-auth"'),
  );
  assert.doesNotMatch(
    privyImport,
    /useWallets/,
    "the account exchange must not gate on Privy's connected-wallet list",
  );
  assert.match(canonicalAccount, /linkedAccounts/);
  // Signing a permit is the one flow that genuinely needs a *connected* wallet,
  // so that hook keeps using useWallets.
  const permission = await read("src/hooks/use-permission-control.ts");
  assert.match(permission, /useWallets/);
});

test("the identity token is read from memory as well as storage", async () => {
  const canonicalAccount = await read("src/hooks/use-canonical-account.ts");

  // `getIdentityToken()` refreshes against Privy's API but reads the result
  // back out of localStorage, which a Telegram webview can partition or drop —
  // on Telegram Web the Mini App is an iframe, so that storage is third-party.
  // Privy also keeps the token in memory, reachable only through the hook, so
  // both sources are consulted before the exchange is declared impossible.
  assert.match(canonicalAccount, /useIdentityToken/);
  assert.match(canonicalAccount, /refreshed\.token \?\? inMemoryIdentityToken/);

  // The three causes that once shared `telegram_privy_credential_unavailable`
  // must stay distinguishable, or staging cannot say which one it hit.
  assert.match(canonicalAccount, /telegram_privy_launch_proof_unavailable/);
  assert.match(canonicalAccount, /telegram_privy_session_unavailable/);
  assert.match(canonicalAccount, /telegram_privy_identity_token_unavailable/);
  assert.match(
    canonicalAccount,
    /telegram_privy_identity_token_refresh_failed_/,
  );
  assert.doesNotMatch(
    canonicalAccount,
    /telegram_privy_credential_unavailable/,
    "the single collapsed credential error must not come back",
  );
});

test("Linking is not shown while the embedded-wallet prerequisite is unresolved", async () => {
  const canonicalAccount = await read("src/hooks/use-canonical-account.ts");

  // A successful Custom-JWT link can precede the embedded wallet appearing on
  // the Privy user. That is a prerequisite wait, not an account exchange in
  // progress. If this guard only checks readyForExchange, an unresolved
  // prerequisite leaves the Mini App on “Linking your Aomi account…” forever
  // with no timeout or error path.
  const noProviderFallback = canonicalAccount.slice(
    canonicalAccount.indexOf("if (authenticated && !provider)"),
    canonicalAccount.indexOf("return provider", canonicalAccount.indexOf("if (authenticated && !provider)")),
  );
  assert.doesNotMatch(
    noProviderFallback,
    /status: "loading"/,
    "only a constructed provider may enter the Linking state",
  );
});
