import {
  AomiApiError,
  RULES_ERROR_CODES,
  type Aomi,
  type AomiRuleChange,
  type AomiRuleUsage,
  type AomiWalletRules,
} from "@aomi-labs/client";
import { formatUnits } from "viem";
import {
  CliError,
  baseUrlOf,
  connect,
  json,
  out,
  type ConnectFlags,
} from "../context";

type Flags = ConnectFlags & { json?: boolean };

/** `used 0.2 / 0.5 SOL`; an unknown token shows raw units and its asset id. */
function usageLine(usage: AomiRuleUsage): string {
  const amount = (value: string) =>
    usage.decimals === null
      ? value
      : formatUnits(BigInt(value), usage.decimals);
  return `used ${amount(usage.used)} / ${amount(usage.cap)} ${usage.symbol ?? usage.asset}`;
}

function timeLeft(expiresAt: number): string {
  const seconds = expiresAt - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "expired";
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)} h left`
    : `${Math.max(1, Math.floor(seconds / 60))} min left`;
}

const changeLines = (change: AomiRuleChange) =>
  change.lines.map((line) => `${line.loosens ? "↑" : "-"} ${line.text}`);

/** One wallet: its sentences, today's use, the admin and any waiting change. */
export function rulesLines(rules: AomiWalletRules): string[] {
  const lines = [`${rules.wallet_name}  ${rules.agent_wallet_id}`];
  if (rules.revision === 0 || !rules.rules.length) lines.push("  No rules");
  for (const sentence of rules.sentences) lines.push(`  ${sentence}`);
  for (const usage of rules.usage) lines.push(`  ${usageLine(usage)}`);
  if (rules.stopped_until) lines.push("  Stopped by the agent until 00:00 UTC");
  lines.push(
    `  Admin: ${
      rules.admin.kind === "wallet"
        ? `${rules.admin.address} (${rules.admin.family}), approves by signing`
        : "Aomi-managed"
    }`,
  );
  const pending = rules.pending;
  if (pending) {
    lines.push(`  Pending ${pending.id} · ${timeLeft(pending.expires_at)}`);
    for (const line of changeLines(pending)) lines.push(`    ${line}`);
  }
  return lines;
}

const rulesUrl = (flags: ConnectFlags, id: string) =>
  `${baseUrlOf(flags)}/rules/${encodeURIComponent(id)}`;

/** `aomi rules`: every agent wallet with its rules. */
export async function list(flags: Flags): Promise<void> {
  const aomi = await connect(flags);
  const { wallets } = await aomi.account.wallets.agentWallets();
  const active = wallets.filter((wallet) => wallet.archived_at === null);
  if (!active.length) return out(flags.json ? "" : "No agent wallets yet");
  let first = true;
  for (const wallet of active) {
    const rules = await aomi.account.rules.get(wallet.id);
    if (flags.json) {
      json(rules);
      continue;
    }
    if (!first) out();
    first = false;
    rulesLines(rules).forEach((line) => out(line));
  }
}

/** The change, when it still waits for the admin. */
async function open(aomi: Aomi, id: string): Promise<AomiRuleChange> {
  let change: AomiRuleChange;
  try {
    change = await aomi.account.rules.getChange(id);
  } catch (error) {
    if (
      error instanceof AomiApiError &&
      error.code === RULES_ERROR_CODES.changeNotFound
    )
      throw new CliError(`No rule change ${id} on this account`);
    throw error;
  }
  if (change.state !== "awaiting_admin")
    throw new CliError(
      `This change isn't waiting for approval (${change.state})`,
    );
  return change;
}

/** What a refused decision means here; anything else is rethrown. */
function refusal(error: unknown, url: string): never {
  if (error instanceof AomiApiError) {
    if (
      error.code === RULES_ERROR_CODES.changeNotOpen ||
      error.code === RULES_ERROR_CODES.changed
    )
      throw new CliError(
        "It was already decided, or the rules changed: aomi rules",
      );
    // The owner's own session decides: an OAuth login opens the page instead.
    if (error.status === 401 || error.status === 403)
      throw new CliError(
        `This sign-in can't decide rule changes; open ${url}`,
        3,
      );
  }
  throw error;
}

function finish(flags: Flags, rules: AomiWalletRules, done: string): void {
  if (flags.json) return json(rules);
  out(done);
  rulesLines(rules).forEach((line) => out(line));
}

/**
 * `aomi rules approve <id>`: approve a change the Aomi-managed admin waits
 * on. A change that needs a wallet's signature prints its page instead.
 */
export async function approve(flags: Flags, id: string): Promise<void> {
  const aomi = await connect(flags);
  const change = await open(aomi, id);
  const url = rulesUrl(flags, id);
  if (change.signer) {
    if (flags.json) json({ ...change, url });
    else {
      changeLines(change).forEach((line) => out(line));
      out(`Needs the signature of ${change.signer.address}. Sign at ${url}`);
    }
    process.exitCode = 3;
    return;
  }
  try {
    finish(flags, await aomi.account.rules.approveChange(id), "Approved");
  } catch (error) {
    refusal(error, url);
  }
}

/** `aomi rules decline <id>`: the rules stay as they are. */
export async function decline(flags: Flags, id: string): Promise<void> {
  const aomi = await connect(flags);
  await open(aomi, id);
  try {
    finish(flags, await aomi.account.rules.declineChange(id), "Declined");
  } catch (error) {
    refusal(error, rulesUrl(flags, id));
  }
}
