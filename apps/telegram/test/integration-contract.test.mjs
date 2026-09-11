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
  assert.match(canonicalAccount, /getEmbeddedConnectedWallet/);
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
