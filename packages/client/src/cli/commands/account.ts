import { CliSession } from "../cli-session";
import { fatal } from "../errors";
import { printDataFileLocation, printJson, printPaymentEvent } from "../output";
import { createCliPaymentFetch } from "../payment";
import type { AomiCreditPosition } from "../../account/credits";
import {
  linkCliSiwsWallet,
  signInWithCliSiwe,
  signInWithCliSiws,
  signOutCliSession,
} from "../auth";
import type { CliConfig } from "../types";
import {
  getDeviceProviderCredential,
  signInWithDeviceProvider,
  type DeviceAuthProvider,
} from "../device-auth";
import { signInWithOAuthDevice } from "../oauth-device-auth";
import {
  buildSignedWalletLink,
  requireAccountGraphClient,
  resolveAccountLink,
  type AccountGraphLinkedAccount,
  type AccountGraphResponse,
  type AccountGraphWallet,
  type ResolvedAccountLink,
} from "../account-graph";
import { resumeSessionCommand, sessionsCommand } from "./sessions";

const DEFAULT_CHAIN_ID = 1;

export type AccountLoginOptions = {
  provider?: string;
  wallet?: boolean;
  solana?: boolean;
  noBrowser?: boolean;
};

export type AccountLinkOptions = {
  provider?: string;
  wallet?: boolean;
  solana?: boolean;
  label?: string;
};

export type AccountRenameOptions = {
  label?: string;
};

export type AccountDeleteOptions = {
  yes?: boolean;
};

export type AccountCreditsShowOptions = {
  limit?: string;
  before?: string;
};

export type AccountCreditsTopUpOptions = {
  idempotencyKey?: string;
};

export async function accountLoginCommand(
  config: CliConfig,
  options: AccountLoginOptions = {},
): Promise<void> {
  const cli = CliSession.loadOrCreate(config);
  if (options.solana && (options.wallet || options.provider)) {
    fatal("Choose only one of `--solana`, `--wallet`, or `--provider`.");
  }
  if (options.solana) {
    await accountLoginWithSiws(cli, config);
    return;
  }
  if (options.wallet || options.noBrowser || config.privateKey) {
    await accountLoginWithSiwe(cli, config);
    return;
  }

  if (
    options.provider &&
    options.provider !== "privy" &&
    options.provider !== "para"
  ) {
    fatal('Unknown --provider value. Use "privy" or "para".');
  }

  if (!options.provider) {
    const origin = new URL(cli.baseUrl).origin;
    const grants = [
      {
        resource: `${origin}/v1/agent` as const,
        scopes: ["agent:read", "agent:write", "offline_access"],
      },
      {
        resource: `${origin}/v1/pipeline` as const,
        scopes: ["pipeline:catalog", "offline_access"],
      },
    ];
    for (const request of grants) {
      const grant = await signInWithOAuthDevice({
        baseUrl: cli.baseUrl,
        resource: request.resource,
        scopes: request.scopes,
      });
      cli.setOAuthGrant(grant);
    }
    if (config.json) {
      printJson({
        status: "signed_in",
        method: "oauth_device",
        resources: grants.map((grant) => grant.resource),
      });
    } else {
      console.log("Signed in with OAuth device authorization");
      printDataFileLocation({ verbose: config.verbose });
    }
    return;
  }

  const provider = options.provider as DeviceAuthProvider | undefined;
  const result = await signInWithDeviceProvider({
    baseUrl: cli.baseUrl,
    provider,
  });
  cli.setAuthSession(result.auth);

  if (config.json) {
    printJson({
      status: "signed_in",
      provider: result.provider ?? null,
      baseUrl: cli.baseUrl,
      expiresAt: new Date(result.auth.expiresAt).toISOString(),
    });
    return;
  }
  console.log(
    `Signed in${result.provider ? ` with ${formatProvider(result.provider)}` : ""}`,
  );
  console.log(
    `Session expires at ${new Date(result.auth.expiresAt).toISOString()}`,
  );
  printDataFileLocation({ verbose: config.verbose });
}

async function accountLoginWithSiws(
  cli: CliSession,
  config: CliConfig,
): Promise<void> {
  const privateKey =
    cli.resolvedSvmPrivateKey(config.solanaPrivateKey) ??
    process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) {
    fatal(
      "No Solana private key configured.\n" +
        "Run `aomi wallet set --solana <solana-private-key>` or pass `--solana-private-key`.",
    );
  }

  const chainId = cli.resolvedSvmCluster(config.svmCluster);
  const result = await signInWithCliSiws({
    baseUrl: cli.baseUrl,
    privateKey: privateKey!,
    chainId,
  });

  cli.setSvmWallet(privateKey!, result.address, chainId);
  cli.setAuthSession(result.auth);

  if (config.json) {
    printJson({
      status: "signed_in",
      provider: "siws",
      address: result.address,
      chainId,
      baseUrl: cli.baseUrl,
      expiresAt: new Date(result.auth.expiresAt).toISOString(),
    });
    return;
  }
  console.log(`Signed in with Solana wallet ${result.address}`);
  console.log(
    `Session expires at ${new Date(result.auth.expiresAt).toISOString()}`,
  );
  printDataFileLocation({ verbose: config.verbose });
}

async function accountLoginWithSiwe(
  cli: CliSession,
  config: CliConfig,
): Promise<void> {
  const privateKey = config.privateKey ?? cli.privateKey;
  if (!privateKey) {
    fatal(
      "No EVM private key configured.\n" +
        "Run `aomi wallet set <evm-private-key>` or pass `--private-key`.",
    );
  }

  const chainId = config.chain ?? cli.chainId ?? DEFAULT_CHAIN_ID;
  const result = await signInWithCliSiwe({
    baseUrl: cli.baseUrl,
    privateKey: privateKey as `0x${string}`,
    chainId,
  });

  cli.setWallet(privateKey!, result.address);
  if (cli.chainId !== chainId) {
    cli.setChainId(chainId);
  }
  cli.setAuthSession(result.auth);

  if (config.json) {
    printJson({
      status: "signed_in",
      provider: "siwe",
      address: result.address,
      chainId,
      baseUrl: cli.baseUrl,
      expiresAt: new Date(result.auth.expiresAt).toISOString(),
    });
    return;
  }
  console.log(`Signed in with ${result.address}`);
  console.log(
    `Session expires at ${new Date(result.auth.expiresAt).toISOString()}`,
  );
  printDataFileLocation({ verbose: config.verbose });
}

function formatProvider(provider: DeviceAuthProvider): string {
  return provider === "privy" ? "Privy" : "Para";
}

export async function accountWhoamiCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.load();
  if (!cli) {
    if (config.json) {
      printJson({ active: false });
      return;
    }
    console.log("No active session");
    printDataFileLocation({ verbose: config.verbose });
    return;
  }
  cli.mergeConfig(config);

  if (cli.auth?.sessionToken) {
    try {
      const account = await requireAccountGraphClient(cli).getAccount();
      if (config.json) {
        printJson(account);
        return;
      }
      printAccountSummary(account);
      printDataFileLocation({ verbose: config.verbose });
      return;
    } catch {
      // Fall through to the backend profile endpoint below. Older sessions or
      // non-portal URLs may not expose the account graph routes yet.
    }
  }

  const session = cli.createClientSession();
  try {
    const account = await session.client.getAccount(cli.sessionId);
    if (config.json) {
      printJson(account);
      return;
    }
    const user = account.user;
    console.log(`Account:  ${user.user_id}`);
    if (user.username) console.log(`Username: ${user.username}`);
    if (user.verified_email) {
      console.log(`Email:    ${user.verified_email}`);
    }
    if (user.tier) console.log(`Tier:     ${user.tier}`);
    if (user.status) console.log(`Status:   ${user.status}`);
    const policies = account.signing_policies;
    console.log(`Wallets:  ${policies.length}`);
    for (const policy of policies) {
      const userAccount = account.user_accounts.find(
        (candidate) =>
          candidate.address.chain === policy.address.chain &&
          (policy.address.chain === "evm"
            ? candidate.address.address.toLowerCase() ===
              policy.address.address.toLowerCase()
            : candidate.address.address === policy.address.address),
      );
      console.log(
        `- ${formatWalletChainType(policy.address.chain)} [${userAccount?.auth_provider ?? "self-custody"}]: ${policy.address.address}`,
      );
    }
    printDataFileLocation({ verbose: config.verbose });
  } catch {
    if (config.json) {
      printJson({
        active: true,
        bound: false,
        hasCredential: hasAccountCredential(cli.toState()),
      });
      return;
    }
    console.log("Not bound to an account (anonymous session).");
    if (!hasAccountCredential(cli.toState())) {
      console.log(
        "No account credential configured. Run `aomi account login` or pass --account-bearer.",
      );
    } else {
      console.log(
        "An account credential was sent, but the backend did not bind or accept this session.",
      );
    }
    printDataFileLocation({ verbose: config.verbose });
  } finally {
    session.close();
  }
}

export const whoamiCommand = accountWhoamiCommand;

export async function accountLinksCommand(config: CliConfig): Promise<void> {
  const cli = loadMergedCli(config);
  const client = requireAccountGraphClient(cli);
  const account = await client.getAccount();
  if (config.json) {
    printJson(account);
    return;
  }
  printAccountLinks(account);
  printDataFileLocation({ verbose: config.verbose });
}

export async function accountLinkCommand(
  config: CliConfig,
  options: AccountLinkOptions = {},
): Promise<void> {
  const cli = loadMergedCli(config);
  const client = requireAccountGraphClient(cli);
  const provider = normalizeProviderOption(options.provider);
  const wantsWallet = options.wallet || (!provider && !options.solana);

  if (
    [
      Boolean(provider),
      Boolean(options.wallet),
      Boolean(options.solana),
    ].filter(Boolean).length > 1
  ) {
    fatal("Choose only one of `--provider`, `--wallet`, or `--solana`.");
  }

  if (options.solana) {
    const privateKey =
      cli.resolvedSvmPrivateKey(config.solanaPrivateKey) ??
      process.env.SOLANA_PRIVATE_KEY;
    if (!privateKey) {
      fatal(
        "No Solana private key configured.\n" +
          "Run `aomi wallet set --solana <solana-private-key>` or pass `--solana-private-key`.",
      );
    }
    const chainId = cli.resolvedSvmCluster(config.svmCluster);
    const result = await linkCliSiwsWallet({
      baseUrl: cli.baseUrl,
      sessionToken: cli.auth!.sessionToken,
      privateKey: privateKey!,
      chainId,
    });
    cli.setSvmWallet(privateKey!, result.address, chainId);
    const account = await client.getAccount();
    if (config.json) {
      printJson({ ...result, account });
      return;
    }
    console.log(
      result.status === "noop"
        ? `Solana login method already linked for ${result.address}`
        : `Linked Solana wallet login method ${result.address}`,
    );
    printAccountLinks(account);
    printDataFileLocation({ verbose: config.verbose });
    return;
  }

  if (provider) {
    const result = await getDeviceProviderCredential({
      baseUrl: cli.baseUrl,
      provider,
      sessionToken: cli.auth?.sessionToken ?? "",
    });
    if (result.status === "conflict") {
      fatal("This login method is already linked to another Aomi account.");
    }
    if (config.json) {
      printJson(result);
      return;
    }
    console.log(`Linked ${formatProvider(provider)} login method`);
    if (result.status === "linked" && result.account) {
      printAccountLinks(result.account);
    }
    printDataFileLocation({ verbose: config.verbose });
    return;
  }

  if (wantsWallet) {
    const body = await buildSignedWalletLink({
      cli,
      config,
      label: options.label,
    });
    const result = await client.linkWallet(body);
    if (config.json) {
      printJson(result);
      return;
    }
    console.log(
      result.status === "noop"
        ? `Login method already linked for ${body.address}`
        : `Linked wallet login method ${body.address}`,
    );
    if (result.account) {
      printAccountLinks(result.account);
    }
    printDataFileLocation({ verbose: config.verbose });
  }
}

export async function accountUnlinkCommand(
  config: CliConfig,
  selector: string,
  options: AccountDeleteOptions = {},
): Promise<void> {
  requireConfirmed(options.yes, "unlink an account login method");
  const cli = loadMergedCli(config);
  const client = requireAccountGraphClient(cli);
  const account = await client.getAccount();
  const link = requireResolvedLink(account, selector);
  if (link.kind === "identity") {
    await client.unlinkIdentity(link.id);
  } else {
    await client.unlinkWallet(link.id);
  }
  if (config.json) {
    printJson({ status: "unlinked", link: serializeResolvedLink(link) });
    return;
  }
  console.log(`Unlinked ${formatResolvedLink(link)}`);
  printDataFileLocation({ verbose: config.verbose });
}

export async function accountRenameCommand(
  config: CliConfig,
  selector: string,
  options: AccountRenameOptions = {},
): Promise<void> {
  if (options.label === undefined) {
    fatal("Pass `--label <name>`.");
  }
  const cli = loadMergedCli(config);
  const client = requireAccountGraphClient(cli);
  const account = await client.getAccount();
  const link = requireResolvedLink(account, selector);
  if (link.kind === "identity") {
    await client.updateIdentity(link.id, { displayLabel: options.label });
  } else {
    await client.updateWallet(link.id, { label: options.label });
  }
  if (config.json) {
    printJson({
      status: "renamed",
      label: options.label,
      link: serializeResolvedLink(link),
    });
    return;
  }
  console.log(`Renamed ${formatResolvedLink(link)}`);
  printDataFileLocation({ verbose: config.verbose });
}

export async function accountUpdateCommand(
  config: CliConfig,
  input: { displayName?: string; avatarUrl?: string },
): Promise<void> {
  if (input.displayName === undefined && input.avatarUrl === undefined) {
    fatal("Pass `--display-name` or `--avatar-url`.");
  }
  const cli = loadMergedCli(config);
  const client = requireAccountGraphClient(cli);
  const account = await client.updateAccount({
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
  });
  if (config.json) {
    printJson(account);
    return;
  }
  console.log("Updated account profile");
  printAccountSummary(account);
  printDataFileLocation({ verbose: config.verbose });
}

export async function accountDeleteCommand(
  config: CliConfig,
  options: AccountDeleteOptions = {},
): Promise<void> {
  requireConfirmed(options.yes, "delete this Aomi account");
  const cli = loadMergedCli(config);
  const client = requireAccountGraphClient(cli);
  const result = await client.deleteAccount();
  cli.clearAuthSession();
  if (config.json) {
    printJson(result);
    return;
  }
  console.log(
    `Deleted account (${result.revokedIdentities} login methods, ${result.revokedWallets} wallets revoked)`,
  );
  printDataFileLocation({ verbose: config.verbose });
}

export async function accountSessionsCommand(config: CliConfig): Promise<void> {
  await sessionsCommand(config);
}

export function accountSwitchCommand(selector: string): void {
  resumeSessionCommand(selector);
}

export async function accountCreditsShowCommand(
  config: CliConfig,
  options: AccountCreditsShowOptions = {},
): Promise<void> {
  const cli = loadMergedCli(config);
  const position = await requireAccountGraphClient(cli).credits.get({
    limit: parsePositiveInteger(options.limit, "--limit") ?? 25,
    beforeId: parsePositiveInteger(options.before, "--before"),
  });
  if (config.json) {
    printJson(position);
    return;
  }
  printCreditPosition(position);
  printDataFileLocation({ verbose: config.verbose });
}

export async function accountCreditsTopUpCommand(
  config: CliConfig,
  rawCredits: string,
  options: AccountCreditsTopUpOptions = {},
): Promise<void> {
  const credits = Number(rawCredits);
  if (!Number.isFinite(credits)) {
    fatal("Credits must be a number between 1 and 100,000.");
  }
  const idempotencyKey = options.idempotencyKey?.trim();
  if (!idempotencyKey) {
    fatal(
      "Provide --idempotency-key for this purchase and reuse it when retrying an unknown payment outcome.",
    );
  }
  const cli = loadMergedCli(config);
  const paymentFetch = createCliPaymentFetch(
    {
      ...config,
      paymentMethod: "coinbase",
      privateKey: config.privateKey ?? cli.privateKey,
    },
    config.json ? undefined : printPaymentEvent,
  );
  const result = await requireAccountGraphClient(
    cli,
    paymentFetch,
  ).credits.topUp({
    credits,
    idempotencyKey,
  });
  if (config.json) {
    printJson(result);
    return;
  }
  console.log(
    `Credit bank: ${formatMicrousd(result.bank.balance_microusd)} credits available`,
  );
  if (result.receipt?.transaction) {
    console.log(`Transaction: ${result.receipt.transaction}`);
  }
  printDataFileLocation({ verbose: config.verbose });
}

function hasAccountCredential(
  state: ReturnType<CliSession["toState"]>,
): boolean {
  return Boolean(
    state.auth?.sessionToken ||
    state.accountBearer ||
    Object.keys(state.oauthGrants ?? {}).length,
  );
}

function formatWalletChainType(chainType: string): string {
  const normalized = chainType.trim().toLowerCase();
  if (normalized === "ethereum" || normalized === "evm") {
    return "Ethereum";
  }
  if (normalized === "solana" || normalized === "svm") {
    return "Solana";
  }
  return chainType;
}

export async function logoutCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.load();
  if (!cli) {
    if (config.json) {
      printJson({ active: false });
      return;
    }
    console.log("No active session");
    printDataFileLocation({ verbose: config.verbose });
    return;
  }
  cli.mergeConfig(config);

  const token = cli.auth?.sessionToken;
  try {
    for (const grant of Object.values(cli.oauthGrants)) {
      const token = grant.refreshToken ?? grant.accessToken;
      await fetch(`${cli.baseUrl}/api/auth/oauth2/revoke`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, client_id: grant.clientId }),
      }).catch(() => undefined);
    }
    await signOutCliSession({
      baseUrl: cli.baseUrl,
      sessionToken: token,
    });
  } finally {
    cli.clearAuthSession();
    cli.clearOAuthGrants();
    cli.clearSigningKeys();
  }

  if (config.json) {
    printJson({ status: "signed_out" });
    return;
  }
  console.log("Signed out");
  printDataFileLocation({ verbose: config.verbose });
}

function loadMergedCli(config: CliConfig): CliSession {
  const cli = CliSession.load();
  if (cli) {
    cli.mergeConfig(config);
    return cli;
  }
  if (config.accountBearer) {
    return CliSession.loadOrCreate(config);
  }
  fatal(
    "No active session. Run `aomi account login` first or pass `--account-bearer`.",
  );
}

function normalizeProviderOption(
  provider: string | undefined,
): DeviceAuthProvider | undefined {
  if (!provider) return undefined;
  const normalized = provider.trim().toLowerCase();
  if (normalized === "privy" || normalized === "para") return normalized;
  fatal('Unknown --provider value. Use "privy" or "para".');
}

function printAccountSummary(account: AccountGraphResponse): void {
  if (!account.user) {
    console.log("No active account");
    return;
  }

  console.log(`Account:  ${account.user.id}`);
  if (account.user.displayName) {
    console.log(`Name:     ${account.user.displayName}`);
  }
  if (account.user.email) {
    console.log(`Email:    ${account.user.email}`);
  }
  if (account.session?.expiresAt) {
    console.log(
      `Session:  expires ${new Date(account.session.expiresAt).toISOString()}`,
    );
  }
  console.log(`Login methods: ${account.linkedAccounts.length}`);
  console.log(`Wallets:       ${account.wallets.length}`);
}

function printAccountLinks(account: AccountGraphResponse): void {
  if (!account.user) {
    console.log("No active account");
    return;
  }

  console.log(`Account:  ${account.user.id}`);
  if (account.user.displayName) {
    console.log(`Name:     ${account.user.displayName}`);
  }
  if (account.user.email) {
    console.log(`Email:    ${account.user.email}`);
  }
  if (account.session?.expiresAt) {
    console.log(
      `Session:  expires ${new Date(account.session.expiresAt).toISOString()}`,
    );
  }

  const identities = account.linkedAccounts ?? [];
  console.log(`Login methods: ${identities.length}`);
  for (const identity of identities) {
    console.log(formatIdentityLine(identity));
    const childWallets = account.wallets.filter((wallet) =>
      walletBelongsToIdentity(wallet, identity),
    );
    for (const wallet of childWallets) {
      console.log(`  ${formatWalletLine(wallet)}`);
    }
  }

  const attachedWalletIds = new Set(
    identities.flatMap((identity) =>
      account.wallets
        .filter((wallet) => walletBelongsToIdentity(wallet, identity))
        .map((wallet) => wallet.id),
    ),
  );
  const otherWallets = account.wallets.filter(
    (wallet) => !attachedWalletIds.has(wallet.id),
  );
  if (otherWallets.length > 0) {
    console.log(`Wallets:  ${otherWallets.length}`);
    for (const wallet of otherWallets) {
      console.log(formatWalletLine(wallet));
    }
  }
}

function serializeResolvedLink(
  link: ResolvedAccountLink,
): Record<string, unknown> {
  return {
    kind: link.kind,
    id: link.id,
    provider:
      link.kind === "identity" ? link.link.provider : link.link.provider,
    family: link.kind === "wallet" ? link.link.family : undefined,
  };
}

function formatIdentityLine(identity: AccountGraphLinkedAccount): string {
  const label = identity.displayLabel ? ` "${identity.displayLabel}"` : "";
  const email = identity.email ? ` <${identity.email}>` : "";
  return `- identity:${identity.id} ${identity.provider}${label}${email}`;
}

function formatWalletLine(wallet: AccountGraphWallet): string {
  const label = wallet.label ? ` "${wallet.label}"` : "";
  const chain = wallet.chainId ? ` chain:${wallet.chainId}` : "";
  const provider = wallet.provider ? ` [${wallet.provider}]` : "";
  return `- wallet:${wallet.id} ${wallet.family}${provider}: ${wallet.address}${chain}${label}`;
}

function walletBelongsToIdentity(
  wallet: AccountGraphWallet,
  identity: AccountGraphLinkedAccount,
): boolean {
  if (wallet.provider && wallet.provider === identity.provider) return true;
  if (wallet.linkedVia === identity.provider) return true;
  return identity.provider === "siwe" && wallet.linkedVia === "siwe";
}

function requireResolvedLink(
  account: AccountGraphResponse,
  selector: string,
): ResolvedAccountLink {
  const link = resolveAccountLink(account, selector);
  if (!link) {
    fatal(
      `No account link found for "${selector}". Run \`aomi account links\`.`,
    );
  }
  return link!;
}

function formatResolvedLink(link: ResolvedAccountLink): string {
  if (link.kind === "identity") {
    return `${link.link.provider} login method identity:${link.id}`;
  }
  return `${link.link.family} wallet login method wallet:${link.id}`;
}

function requireConfirmed(
  confirmed: boolean | undefined,
  action: string,
): void {
  if (!confirmed) {
    fatal(`Refusing to ${action} without --yes.`);
  }
}

function parsePositiveInteger(
  value: string | undefined,
  flag: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fatal(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function printCreditPosition(position: AomiCreditPosition): void {
  console.log(
    `Monthly:     ${formatMicrousd(position.included.used_microusd)} / ${formatMicrousd(position.included.limit_microusd)} credits used`,
  );
  console.log(
    `Credit bank: ${formatMicrousd(position.bank.balance_microusd)} credits available`,
  );
  if (position.entries.length === 0) {
    console.log("Activity:    none");
    return;
  }
  console.log("Activity:");
  for (const entry of position.entries) {
    const sign = entry.amount_microusd >= 0 ? "+" : "";
    const detail = entry.payment_method ? ` via ${entry.payment_method}` : "";
    console.log(
      `- ${sign}${formatMicrousd(entry.amount_microusd)} ${entry.entry_kind}${detail} · ${new Date(entry.created_at * 1000).toISOString()}`,
    );
  }
}

function formatCredits(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatMicrousd(value: number): string {
  return formatCredits(value / 10_000);
}
