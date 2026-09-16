import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readWorkspace = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("Para login resolves the canonical Aomi account", async () => {
  const [providers, canonicalAccount] = await Promise.all([
    read("src/app/providers.tsx"),
    read("src/hooks/use-canonical-account.ts"),
  ]);

  assert.match(providers, /oAuthMethods: \["GOOGLE", "TELEGRAM"\]/);
  assert.match(canonicalAccount, /createProviderCredentialAdapter/);
  assert.match(canonicalAccount, /paraClient\.issueJwt/);
  assert.match(canonicalAccount, /createAccountSessionProvider/);
  assert.match(canonicalAccount, /\/api\/auth\/widget\/telegram\/exchange/);
  assert.match(canonicalAccount, /\/v1\/account/);
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

test("the Mini App only links Para and signs permission permits", async () => {
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
  assert.doesNotMatch(
    page,
    /ActionHandler|sendTransaction|Sign All|transaction bundle/i,
  );
  assert.doesNotMatch(permission, /waitForTransactionReceipt|sendTransaction/);
});

test("Para and the app share one React Query context", async () => {
  const nextConfig = await read("next.config.ts");

  assert.match(nextConfig, /"@tanstack\/react-query"/);
  assert.match(nextConfig, /appNodeModules/);
});

test("the legacy relay and multi-page wallet are absent", async () => {
  const [packageJson, page] = await Promise.all([
    read("package.json"),
    read("src/app/page.tsx"),
  ]);

  assert.doesNotMatch(packageJson, /walletconnect|wagmi|privy/i);
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
