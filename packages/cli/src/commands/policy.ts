import {
  AomiApiError,
  AomiPolicyFieldError,
  POLICY_ERROR_CODES,
  assetChain,
  assetNetwork,
  catalogOn,
  chainOnlyPolicies,
  checkPolicy,
  expectedPolicyAction,
  fromBaseUnits,
  hasPolicies,
  matchPolicyIds,
  policyFromInput,
  policyKey,
  policyOnChain,
  shortAddress,
  upsertPolicy,
  whitelistOnlyProvider,
  withoutPolicy,
  type Aomi,
  type AomiPolicy,
  type AomiPolicyAction,
  type AomiPolicyAdmin,
  type AomiPolicyCatalog,
  type AomiPolicyChange,
  type AomiPolicyChangeRequest,
  type AomiPolicyOnChain,
  type AomiWalletPolicies,
} from "@aomi-labs/client";
import {
  CliError,
  baseUrlOf,
  confirm,
  connect,
  json,
  messageOf,
  out,
  policySigner,
  table,
  usage,
  type ConnectFlags,
} from "../context";
import { readArgs } from "./pipeline";

/** On screen and in the paths a policy; in the wire's field names, a rule. */
export type Flags = ConnectFlags & { json?: boolean; wallet?: string };

function timeLeft(expiresAt: number): string {
  const seconds = expiresAt - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "expired";
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)} h left`
    : `${Math.max(1, Math.floor(seconds / 60))} min left`;
}

const changeLines = (change: AomiPolicyChange) =>
  change.lines.map((line) => `${line.loosens ? "↑" : "-"} ${line.text}`);

const idOf = (policy: AomiPolicy) => policy.id ?? policyKey(policy);

/** `0.5 SOL`; base units when the token's decimals are not known. */
function amountOf(policy: AomiPolicy, catalog?: AomiPolicyCatalog): string {
  const token = catalog?.tokens.find((known) => known.asset === policy.asset);
  const symbol = policy.symbol ?? token?.symbol;
  const decimals = policy.decimals ?? token?.decimals;
  return symbol && typeof decimals === "number"
    ? `${fromBaseUnits(policy.amount, decimals)} ${symbol}`
    : `${policy.amount} ${policy.asset}`;
}

/** `Up to 0.5 SOL on Jupiter (Solana)`. */
export function sentence(
  policy: AomiPolicy,
  catalog?: AomiPolicyCatalog,
): string {
  const { to } = policy;
  const amount = amountOf(policy, catalog);
  const where =
    to.kind === "any_protocol"
      ? "on any app"
      : to.kind === "address"
        ? `to ${shortAddress(to.address)}`
        : `on ${
            catalog?.apps.find((app) => app.id === to.id)?.label ??
            `${to.id.charAt(0).toUpperCase()}${to.id.slice(1)}`
          }`;
  return `${/^0+$/.test(policy.amount) ? `No ${amount.split(" ")[1]}` : `Up to ${amount}`} ${where} (${assetChain(policy.asset, catalog)})`;
}

/** The policy's last day; `--until` and this are both UTC days. */
const untilOf = (policy: AomiPolicy) =>
  typeof policy.active_until === "number"
    ? `${new Date(policy.active_until * 1000).toISOString().slice(0, 10)} UTC`
    : "always";

const ON_CHAIN: Record<AomiPolicyOnChain["kind"], string> = {
  in_sync: "in sync",
  not_deployed: "not deployed",
  out_of_date: "out of date",
  unverified: "not verified",
  chain_only: "on chain only",
  needs_whitelist: "needs whitelist mode",
  aomi_only: "Aomi only",
};

/** `in sync (Swig)`, `not deployed`, `needs whitelist mode`, `Aomi only`. */
export const onChain = (status: AomiPolicyOnChain): string =>
  ["in_sync", "out_of_date", "unverified"].includes(status.kind) &&
  "entry" in status
    ? `${ON_CHAIN[status.kind]} (${status.entry.name})`
    : ON_CHAIN[status.kind];

const authorityOf = (admin: AomiPolicyAdmin) =>
  admin.kind === "wallet"
    ? `${admin.address} (${admin.family}), approves by signing`
    : "self-approval";

/**
 * ` --wallet <id>` for a command printed to run next. Left out only when the
 * account's `only` agent wallet was used without being named.
 */
const walletArg = (policies: AomiWalletPolicies, only: boolean) =>
  only ? "" : ` --wallet ${policies.agent_wallet_id}`;

/** One wallet: mode and authority, its policies, any waiting change. */
export function policyLines(
  policies: AomiWalletPolicies,
  only = false,
): string[] {
  const { rules } = policies;
  const lines = [
    `${policies.wallet_name}  ${policies.agent_wallet_id}`,
    `  Mode: ${rules.mode} · Authority: ${authorityOf(policies.admin)}`,
  ];
  const removed = chainOnlyPolicies(policies);
  if (!hasPolicies(rules) && !removed.length) lines.push("  No policies");
  if (rules.rules.length || removed.length)
    lines.push(
      ...table([
        ["ID", "POLICY", "UNTIL", "ON CHAIN"],
        ...rules.rules.map((policy) => [
          idOf(policy),
          sentence(policy),
          untilOf(policy),
          onChain(policyOnChain(policies, idOf(policy))!),
        ]),
        ...removed.map((id) => [id, "removed from Aomi", "-", "on chain only"]),
      ]).map((row) => `  ${row}`),
    );
  if (rules.linked_only) lines.push("  Sends only to your linked wallets");
  if (policies.stopped_until)
    lines.push("  Stopped by the agent until 00:00 UTC");
  const pending = policies.pending;
  if (pending) {
    lines.push(`  Pending ${pending.id} · ${timeLeft(pending.expires_at)}`);
    for (const line of changeLines(pending)) lines.push(`    ${line}`);
  }
  for (const id of removed)
    lines.push(
      `  On chain only: ${id}. Run aomi policy undeploy ${id}${walletArg(policies, only)}`,
    );
  return lines;
}

const changeUrl = (flags: ConnectFlags, id: string) =>
  `${baseUrlOf(flags)}/policy/${encodeURIComponent(id)}`;

/** Settings › Policies on the wallet, at the policy. */
const policyUrl = (flags: ConnectFlags, walletId: string, id: string) =>
  `${baseUrlOf(flags)}/?${new URLSearchParams({ settings: "policies", wallet: walletId, policy: id })}`;

/** The policy `typed` names: its id, or the one id that starts with it. */
function named(policies: AomiWalletPolicies, typed: string): string {
  const ids = matchPolicyIds(policies, typed);
  if (ids.length > 1)
    throw new CliError(
      `${typed} matches ${ids.length} policies: ${ids.join(", ")}`,
    );
  return ids[0] ?? typed;
}

/**
 * The commands that bring the chain in line with Aomi. `focus` is the policy
 * the command was about; it may not be held yet, or any more.
 */
export function nextLines(
  flags: ConnectFlags,
  policies: AomiWalletPolicies,
  focus?: Pick<AomiPolicy, "asset" | "to">,
  only = false,
): string[] {
  const lines: string[] = [];
  const wallet = walletArg(policies, only);
  const pending = policies.pending;
  if (pending)
    lines.push(
      pending.signer
        ? `Sign at ${changeUrl(flags, pending.id)}   ${pending.signer.address} must sign`
        : `aomi policy approve ${pending.id}   waiting for approval`,
    );
  const focusId = focus && policyKey(focus);
  let aomiOnly = false;
  let needsWhitelist = false;
  for (const id of [
    ...new Set([
      ...policies.rules.rules.map(idOf),
      ...(focusId ? [focusId] : []),
    ]),
  ]) {
    const status = policyOnChain(policies, id);
    if (status?.kind === "not_deployed")
      lines.push(
        `aomi policy deploy ${id}${wallet}   not on chain yet; put it there`,
      );
    else if (status?.kind === "out_of_date")
      lines.push(
        `aomi policy deploy ${id}${wallet}   the chain holds an earlier version; replace it`,
      );
    else if (status?.kind === "unverified")
      lines.push(`aomi policy list   ${status.entry.name} could not be read`);
    else if (id !== focusId) continue;
    else if (status?.kind === "needs_whitelist") needsWhitelist = true;
    else if (status?.kind === "aomi_only") aomiOnly = true;
    else if (!status && pending) {
      // Not held until the change is approved: a provider on its chain can.
      const network = assetNetwork(focus!.asset);
      if (whitelistOnlyProvider(policies, network)) needsWhitelist = true;
      else if (
        policies.providers.some((provider) => provider.network === network)
      )
        lines.push(
          `aomi policy deploy ${id}${wallet}   once approved: not on chain yet; put it there`,
        );
      else aomiOnly = true;
    }
  }
  for (const id of chainOnlyPolicies(policies)) {
    const status = policyOnChain(policies, id);
    const name = status && "entry" in status ? status.entry.name : "The chain";
    lines.push(
      `Still on chain: ${name} holds ${id}. Run aomi policy undeploy ${id}${wallet}`,
    );
  }
  if (needsWhitelist)
    lines.push(
      `aomi policy mode whitelist${wallet}   on-chain providers hold policies only in whitelist mode`,
    );
  if (aomiOnly)
    lines.push(
      "Enforced by Aomi only: no on-chain provider holds this kind of policy",
    );
  return lines.length ? lines : ["Nothing: Aomi and the chain agree"];
}

function printNext(lines: string[]): void {
  out("Next");
  lines.forEach((line) => out(`  ${line}`));
}

const active = async (aomi: Aomi) =>
  (await aomi.account.wallets.agentWallets()).wallets.filter(
    (wallet) => wallet.archived_at === null,
  );

/** `--wallet`, else the account's one agent wallet. */
export async function walletOf(aomi: Aomi, flags: Flags): Promise<string> {
  if (flags.wallet) return flags.wallet;
  const wallets = await active(aomi);
  if (wallets.length === 1) return wallets[0]!.id;
  throw usage(
    wallets.length
      ? `Pass --wallet <id>: ${wallets.map((wallet) => `${wallet.id} (${wallet.name})`).join(", ")}`
      : "No agent wallets yet",
  );
}

/** `aomi policy`: each agent wallet with its policies and where they stand on chain. */
export async function list(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const ids = flags.wallet
    ? [flags.wallet]
    : (await active(aomi)).map((wallet) => wallet.id);
  if (!ids.length) return out(flags.json ? "" : "No agent wallets yet");
  let first = true;
  for (const id of ids) {
    const policies = await aomi.account.policy.get(id);
    if (flags.json) {
      json(policies);
      continue;
    }
    if (!first) out();
    first = false;
    policyLines(policies, !flags.wallet && ids.length === 1).forEach((line) =>
      out(line),
    );
  }
}

/** A policy the SDK refused names its field; the nearest catalog values follow. */
function fieldError(error: unknown): never {
  if (error instanceof AomiPolicyFieldError)
    throw usage(
      `${error.message}${error.nearest.length ? `. Nearest: ${error.nearest.join(", ")}` : ""}`,
    );
  throw error;
}

/** Here `--chain` names a policy's chain, not the chain the signer is on. */
type OnChain<F> = Omit<F, "chain"> & { chain?: string };

/** `aomi policy catalog`: the apps and tokens a policy can name. */
export async function catalog({ chain, ...flags }: OnChain<Flags>) {
  const aomi = await connect(flags);
  const all = await aomi.account.policy.catalog();
  let shown = all;
  try {
    if (chain) shown = catalogOn(all, chain);
  } catch (error) {
    fieldError(error);
  }
  if (flags.json) return json(shown);
  out("APPS");
  table([
    ["ID", "NAME", "CHAINS"],
    ...shown.apps.map((app) => [app.id, app.label, app.chains.join(", ")]),
  ]).forEach((row) => out(`  ${row}`));
  out("TOKENS");
  table([
    ["SYMBOL", "CHAIN", "DECIMALS", "ASSET"],
    ...shown.tokens.map((token) => [
      token.symbol,
      token.chain,
      String(token.decimals),
      token.asset,
    ]),
  ]).forEach((row) => out(`  ${row}`));
}

/** The change, when it still waits for the admin and is `--wallet`'s. */
async function open(
  aomi: Aomi,
  id: string,
  { wallet }: Flags,
): Promise<AomiPolicyChange> {
  let change: AomiPolicyChange;
  try {
    change = await aomi.account.policy.getChange(id);
  } catch (error) {
    if (
      error instanceof AomiApiError &&
      error.code === POLICY_ERROR_CODES.changeNotFound
    )
      throw new CliError(`No policy change ${id} on this account`);
    throw error;
  }
  if (change.state !== "awaiting_admin")
    throw new CliError(
      `This change isn't waiting for approval (${change.state})`,
    );
  if (wallet && wallet !== change.agent_wallet_id)
    throw new CliError(
      `Change ${id} is for wallet ${change.agent_wallet_id}, not ${wallet}. Nothing was decided`,
    );
  return change;
}

/** What a refused write or decision means here; anything else is rethrown. */
function refusal(error: unknown, url: string): never {
  if (error instanceof AomiApiError) {
    if (
      error.code === POLICY_ERROR_CODES.changeNotOpen ||
      error.code === POLICY_ERROR_CODES.changed
    )
      throw new CliError(
        "It was already decided, or the policies changed: aomi policy",
      );
    // The owner's own session decides: an OAuth login opens the page instead.
    if (error.status === 401 || error.status === 403)
      throw new CliError(`This sign-in can't change policies; open ${url}`, 3);
  }
  throw error;
}

function decided(
  flags: Flags,
  policies: AomiWalletPolicies,
  done: string,
): void {
  if (flags.json) return json(policies);
  out(done);
  policyLines(policies).forEach((line) => out(line));
  printNext(nextLines(flags, policies));
}

/** The page where a wallet authority signs; exit 3, nothing was approved. */
function needsSignature(flags: Flags, change: AomiPolicyChange): void {
  const url = changeUrl(flags, change.id);
  if (flags.json) json({ ...change, url });
  else {
    changeLines(change).forEach((line) => out(line));
    out(`Needs the signature of ${change.signer!.address}. Sign at ${url}`);
  }
  process.exitCode = 3;
}

/**
 * `aomi policy approve <id>`: approve a change the Aomi-managed authority
 * waits on. A change that needs a wallet's signature prints its page instead.
 */
export async function approve(flags: Flags, id: string): Promise<void> {
  const aomi = await connect(flags);
  const change = await open(aomi, id, flags);
  if (change.signer) return needsSignature(flags, change);
  try {
    decided(flags, await aomi.account.policy.approveChange(id), "Approved");
  } catch (error) {
    refusal(error, changeUrl(flags, id));
  }
}

/** `aomi policy decline <id>`: the policies stay as they are. */
export async function decline(flags: Flags, id: string): Promise<void> {
  const aomi = await connect(flags);
  await open(aomi, id, flags);
  try {
    decided(flags, await aomi.account.policy.declineChange(id), "Declined");
  } catch (error) {
    refusal(error, changeUrl(flags, id));
  }
}

type Row = [field: string, before: string, after: string];

/**
 * One change to a wallet's policies, start to finish: read, build, write
 * (the SDK retries once when they moved), then what changed, whether it is
 * live, and what brings the chain in line.
 */
async function change(
  flags: Flags & { yes?: boolean },
  aomi: Aomi,
  walletId: string,
  build: (held: AomiWalletPolicies) => {
    request: AomiPolicyChangeRequest;
    title: string;
    rows: Row[];
    focus?: Pick<AomiPolicy, "asset" | "to">;
  },
): Promise<void> {
  let built!: ReturnType<typeof build>;
  let result;
  try {
    result = await aomi.account.policy.revise(walletId, (held) => {
      built = build(held);
      return built.request;
    });
  } catch (error) {
    refusal(error, baseUrlOf(flags));
  }
  let { status, rules: policies } = result;
  const filed = status === "waiting" ? policies.pending : null;
  // The server's verdict: a change that gives the agent power waits.
  const loosens = filed?.lines.some((line) => line.loosens) ?? false;
  const signer = filed?.signer ?? null;
  if (filed && !signer && flags.yes)
    try {
      policies = await aomi.account.policy.approveChange(filed.id);
      status = "applied";
    } catch (error) {
      refusal(error, changeUrl(flags, filed.id));
    }
  if (flags.json) {
    json({
      status,
      ...(filed ? { change_id: filed.id } : {}),
      loosens,
      rules: policies,
    });
  } else {
    out(built.title);
    const changed = built.rows.filter(([, before, after]) => before !== after);
    // The server says whether anything changed; the rows only show what.
    if (status === "unchanged") out("No change");
    else {
      out(loosens ? "LOOSENS" : "TIGHTENS");
      if (changed.length)
        table([["FIELD", "BEFORE", "AFTER"], ...changed]).forEach((row) =>
          out(`  ${row}`),
        );
      out(
        status === "applied"
          ? "Applied"
          : `Filed as ${filed!.id} · waiting for approval`,
      );
    }
    if (signer && status === "waiting" && flags.yes)
      out(
        `--yes was not applied: authority is wallet ${signer.address}, which must sign`,
      );
    printNext(nextLines(flags, policies, built.focus, !flags.wallet));
  }
  // Waiting for an approval or a signature, as `aomi policy approve` exits.
  if (status === "waiting") process.exitCode = 3;
}

/** What the agent may do with a token no policy names. */
const unnamed = (policies: AomiWalletPolicies) =>
  policies.rules.mode === "whitelist" ? "not allowed" : "no limit";

type SetFlags = OnChain<Flags> & {
  amt?: string;
  to?: string;
  until?: string;
  yes?: boolean;
};

const SET_USAGE =
  "aomi policy set <json | path>, or aomi policy set --amt <amount> <asset> --to <app-id|address>";

/** `aomi policy set`: add one policy, or replace the one on its token and destination. */
export async function set(
  { chain, ...flags }: SetFlags,
  input?: string,
): Promise<void> {
  if (!input) throw usage(SET_USAGE);
  const typed = flags.amt !== undefined;
  if (typed ? !flags.to : flags.to || flags.until || chain)
    throw usage(SET_USAGE);
  const aomi = await connect(flags);
  const walletId = await walletOf(aomi, flags);
  const known = await aomi.account.policy.catalog();
  let policy: AomiPolicy;
  try {
    policy = typed
      ? policyFromInput(
          {
            amount: flags.amt!,
            asset: input,
            to: flags.to!,
            until: flags.until,
            chain,
          },
          known,
        )
      : checkPolicy(await readArgs(input), known);
  } catch (error) {
    if (error instanceof SyntaxError)
      throw usage(`policy: not JSON (${error.message})`);
    fieldError(error);
  }
  const id = policyKey(policy);
  await change(flags, aomi, walletId, (held) => {
    const before = held.rules.rules.find((one) => idOf(one) === id);
    return {
      request: {
        rules: {
          ...held.rules,
          rules: upsertPolicy(held.rules.rules, policy),
        },
      },
      title: `${sentence(policy, known)}${policy.active_until ? `, until ${untilOf(policy)}` : ""}`,
      rows: [
        [
          "amount",
          before ? amountOf(before, known) : unnamed(held),
          amountOf(policy, known),
        ],
        ["until", before ? untilOf(before) : "-", untilOf(policy)],
      ],
      focus: policy,
    };
  });
}

/** `aomi policy remove <policy-id>`. */
export async function remove(
  flags: Flags & { yes?: boolean },
  typed: string,
): Promise<void> {
  const aomi = await connect(flags);
  const walletId = await walletOf(aomi, flags);
  // Resolved once: a retry removes this policy or nothing, never another
  // one the same prefix has come to match.
  let id: string | undefined;
  await change(flags, aomi, walletId, (held) => {
    id ??= named(held, typed);
    const policy = held.rules.rules.find((one) => idOf(one) === id);
    if (!policy)
      throw new CliError(
        policyOnChain(held, id)
          ? `Aomi no longer holds ${id}, the chain does: aomi policy undeploy ${id}${walletArg(held, !flags.wallet)}`
          : `No policy ${id} on this wallet: aomi policy list`,
      );
    return {
      request: {
        rules: { ...held.rules, rules: withoutPolicy(held.rules.rules, id) },
      },
      title: `Remove: ${sentence(policy)}`,
      rows: [["amount", amountOf(policy), unnamed(held)]],
      focus: policy,
    };
  });
}

/** `aomi policy mode whitelist|blacklist`. */
export async function mode(
  flags: Flags & { yes?: boolean },
  wanted: string,
): Promise<void> {
  if (wanted !== "whitelist" && wanted !== "blacklist")
    throw usage("Mode is whitelist or blacklist");
  const aomi = await connect(flags);
  const walletId = await walletOf(aomi, flags);
  await change(flags, aomi, walletId, (held) => ({
    request: { rules: { ...held.rules, mode: wanted } },
    title:
      wanted === "whitelist"
        ? "Whitelist: only what the policies list"
        : "Blacklist: all allowed unless a policy caps it",
    rows: [["mode", held.rules.mode, wanted]],
  }));
}

/** `aomi policy authority self|<address>`: who approves a change that loosens. */
export async function authority(
  flags: Flags & { yes?: boolean },
  wanted: string,
): Promise<void> {
  const aomi = await connect(flags);
  const walletId = await walletOf(aomi, flags);
  await change(flags, aomi, walletId, (held) => {
    const admin: AomiPolicyAdmin | undefined =
      wanted === "self"
        ? { kind: "aomi_managed" }
        : held.admin_wallets.find((wallet) =>
            // Only an EVM address reads the same in either case.
            wallet.family === "evm"
              ? wallet.address.toLowerCase() === wanted.toLowerCase()
              : wallet.address === wanted,
          );
    if (!admin)
      throw new CliError(
        `authority: ${wanted} is not a wallet linked to this account${
          held.admin_wallets.length
            ? `: ${held.admin_wallets.map((wallet) => wallet.address).join(", ")}`
            : ""
        }`,
      );
    return {
      request: { admin },
      title: `Authority: ${authorityOf(admin)}`,
      rows: [["authority", authorityOf(held.admin), authorityOf(admin)]],
    };
  });
}

type EnforceFlags = Flags & { provider?: string; yes?: boolean };

/** A key that is not one of the account's wallets cannot own a policy. */
const notOwnWallet = (
  flags: ConnectFlags,
  family: "evm" | "svm",
  address: string,
) =>
  new CliError(
    `The local signer ${address} is not one of this account's wallets, so it cannot own this policy. Sign in with it (${
      family === "evm"
        ? "--private-key"
        : "--solana-private-key without --private-key"
    }) or link it to this account at ${baseUrlOf(flags)}. Nothing was signed`,
    3,
  );

const ACTIONS: Record<AomiPolicyAction["kind"], string> = {
  transaction: "Solana transaction",
  typed_data: "EIP-712 signature; nothing is sent",
  evm_transaction: "EVM transaction; the signer pays the gas",
};
const NO_ACTION = "none; Aomi only reads the chain";

/**
 * One policy onto the chain, or off it: the checks, the question, then the
 * SDK's prepare, sign + send and confirm with the local signer.
 */
async function enforce(
  flags: EnforceFlags,
  typed: string,
  remove: boolean,
): Promise<void> {
  const aomi = await connect(flags);
  const walletId = await walletOf(aomi, flags);
  const held = await aomi.account.policy.get(walletId);
  const id = named(held, typed);
  if (
    flags.provider &&
    !held.enforcement.some((entry) => entry.provider === flags.provider)
  )
    throw new CliError(
      `No provider ${flags.provider} on this wallet${
        held.providers.length
          ? `: ${held.providers.map((provider) => provider.provider).join(", ")}`
          : ""
      }`,
    );
  const status = policyOnChain(held, id, flags.provider);
  if (!status)
    throw new CliError(
      `No policy ${id} on this wallet or on chain: aomi policy list`,
    );
  if (remove && !("entry" in status && status.kind !== "not_deployed"))
    throw new CliError(`Nothing on chain for ${id}`);
  if (!remove && status.kind === "chain_only")
    throw new CliError(
      `Aomi no longer holds ${id}. To take it off the chain: aomi policy undeploy ${id}${walletArg(held, !flags.wallet)}`,
    );
  if (status.kind === "needs_whitelist")
    throw new CliError(
      `${status.provider.name} holds policies only in whitelist mode, and this wallet is in blacklist mode: aomi policy mode whitelist${walletArg(held, !flags.wallet)}`,
    );
  if (status.kind === "aomi_only")
    throw new CliError(
      `No on-chain provider can hold this policy${status.note ? ` (${status.note})` : ""}. Aomi checks it on every commit`,
    );
  const { entry } = status;
  if (!remove && !entry.ready) {
    if (status.kind !== "in_sync")
      throw new CliError(
        `${entry.name} has nothing to deploy for it${entry.note ? `: ${entry.note}` : ""}`,
      );
    return flags.json
      ? json({ settled: true, on_chain: status.kind, rules: held })
      : out(`Already ${onChain(status)}`);
  }
  const { family } = entry.signer;
  const local = aomi.wallet?.[family]?.address;
  const verb = remove ? "undeploy" : "deploy";
  // `next` is about a policy as Aomi holds it, not one `undeploy` forces off.
  const kind = expectedPolicyAction(entry, {
    remove,
    inForce: status.kind !== "chain_only",
  });
  // A step that asks nothing of a wallet needs no key, only the owner's name.
  const owner = entry.signer.address ?? local;
  if (!owner || (kind && !local))
    throw new CliError(
      `No local ${family === "evm" ? "EVM" : "Solana"} key for the wallet that owns this policy${
        entry.signer.address ? ` (${entry.signer.address})` : ""
      }: aomi wallets signer set, or ${verb} it at ${policyUrl(flags, walletId, id)}`,
      3,
    );
  if (
    local &&
    kind &&
    (family === "evm"
      ? local.toLowerCase() !== owner.toLowerCase()
      : local !== owner)
  )
    throw new CliError(
      `The local signer ${local} is not ${owner}, the wallet that owns this policy. Nothing was signed`,
    );
  // A policy with no owner on chain yet takes the local key as its owner,
  // and the backend only takes one of the account's own wallets.
  if (!entry.signer.address) {
    const wallets = await aomi.account.wallets.list();
    if (
      !wallets.some(
        (wallet) =>
          wallet.family === family &&
          (family === "evm"
            ? wallet.address.toLowerCase() === owner.toLowerCase()
            : wallet.address === owner),
      )
    )
      throw notOwnWallet(flags, family, owner);
  }
  const policy = held.rules.rules.find((one) => idOf(one) === id);
  const say = (line: string) => void (flags.json || out(line));
  const row = (name: string, text: string) =>
    say(`  ${name.padEnd(11)}  ${text}`);
  say(`${remove ? "Undeploy" : "Deploy"}: ${policy ? sentence(policy) : id}`);
  row("provider", `${entry.name} on ${entry.network}`);
  row(
    "signer",
    `${owner}${local === owner ? " (local key)" : ""} ${entry.signer.address ? "owns this policy" : "will own it on chain"}`,
  );
  row("action", kind ? ACTIONS[kind] : NO_ACTION);
  if (!flags.yes && !(await confirm(kind ? "Sign and send?" : "Confirm?")))
    throw new CliError("Not sent");
  let asked = false;
  let sent: string | undefined;
  const signer = policySigner(aomi, flags);
  /** The same step, said once the wallet has done it. */
  const said = <In, Out>(act?: (input: In) => Promise<Out>) =>
    act &&
    (async (input: In) => {
      const result = await act(input);
      if (kind !== "typed_data" && typeof result === "string") sent = result;
      // A sent transaction is named at once: whatever follows, it is out.
      row(
        "sign + send",
        kind === "typed_data"
          ? "signed"
          : `sent${typeof result === "string" ? ` ${result}` : ""}`,
      );
      return result;
    });
  let result;
  try {
    result = await aomi.account.policy.enforce(
      walletId,
      entry,
      {
        ...signer,
        signTypedData: said(signer.signTypedData),
        sendEvmTransaction: said(signer.sendEvmTransaction),
        sendSolanaTransaction: said(signer.sendSolanaTransaction),
      },
      {
        revision: held.revision,
        owner,
        remove,
        onAction: (action) => {
          // Thrown before the wallet is asked: nothing is signed.
          if (action.kind !== kind)
            throw new CliError(
              `Aomi asked for another action (${ACTIONS[action.kind]}) than the one you confirmed. Nothing was signed`,
            );
          asked = true;
          row("prepare", "ready to sign");
        },
      },
    );
  } catch (error) {
    // What was sent is out, whatever failed after it: a script must not
    // send it again for want of its reference.
    if (flags.json && sent)
      json({
        error: {
          message: messageOf(error),
          ...(error instanceof AomiApiError ? { code: error.code } : {}),
          transaction: sent,
        },
      });
    if (error instanceof AomiApiError && error.code === "account_not_found")
      throw notOwnWallet(flags, family, owner);
    refusal(error, baseUrlOf(flags));
  }
  const { policies, settled, transaction } = result;
  const now = policyOnChain(policies, id, flags.provider);
  if (flags.json)
    return json({
      settled,
      ...(transaction ? { transaction } : {}),
      on_chain: now?.kind ?? null,
      rules: policies,
    });
  if (!asked) {
    row("prepare", "the chain already matches");
    row("sign + send", "nothing to sign");
  }
  row("confirm", settled ? "Aomi read the chain" : "not on Aomi's node yet");
  out(`On chain: ${now ? onChain(now) : "nothing"}`);
  printNext(
    settled
      ? nextLines(flags, policies, undefined, !flags.wallet)
      : [
          `aomi policy list   ${transaction ? `${transaction} was sent; ` : ""}check again before sending anything more`,
        ],
  );
}

/** `aomi policy deploy <policy-id>`: put a policy Aomi holds on chain. */
export const deploy = (flags: EnforceFlags, id: string) =>
  enforce(flags, id, false);

/** `aomi policy undeploy <policy-id>`: take it off, held by Aomi or not. */
export const undeploy = (flags: EnforceFlags, id: string) =>
  enforce(flags, id, true);
