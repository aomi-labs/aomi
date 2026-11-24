import {
  CommitApprovalForbiddenError,
  CommitExpiredError,
  CommitNotFoundError,
  CommitStaleError,
  isTerminalCommit,
  type Aomi,
  type CommitHandle,
  type CommitRefView,
} from "@aomi-labs/client";
import {
  ask,
  confirm,
  CliError,
  connect,
  err,
  json,
  out,
  rpcReady,
  usage,
  type ConnectFlags,
} from "../context";
import { Card } from "../review";
import { loadState } from "../state";

type Flags = ConnectFlags & { json?: boolean };
const TIMEOUT_MS = 120_000;

async function open(aomi: Aomi, ref: string): Promise<CommitHandle> {
  try {
    return await aomi.commits.get(ref);
  } catch (error) {
    if (error instanceof CommitNotFoundError)
      throw new CliError(`No commit ${ref} on this account`);
    throw error;
  }
}

/** Where the commit ended up. */
function outcome(view: CommitRefView): string {
  if (view.state === "confirmed")
    return view.signature
      ? `Signed · ${view.signature}`
      : `Confirmed · ${view.transaction_url ?? view.transaction_id ?? ""}`;
  if (isTerminalCommit(view))
    return `${view.state} · ${view.failure_code ?? "no failure code"}`;
  return `Still ${view.state}; aomi tx review ${view.commit_id}`;
}

/** Follow the whole batch until it is over, or the timeout. */
async function follow(handle: CommitHandle): Promise<CommitRefView> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!handle.settlement.done && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await handle.refresh();
  }
  const { done, failed, last } = handle.settlement;
  return done ? (failed ?? last) : handle.next.view;
}

function finish(flags: Flags, view: CommitRefView) {
  if (flags.json) json(view);
  else out(outcome(view));
  if (view.state !== "confirmed")
    process.exitCode = isTerminalCommit(view) ? 1 : 4;
}

/** `aomi tx`: what the current thread left to sign or approve. */
export async function list(flags: Flags & { thread?: string }): Promise<void> {
  const thread = flags.thread ?? loadState().thread;
  if (!thread) return out("No thread yet");
  const aomi = await connect(flags);
  const session = await aomi.agent.openSession(thread);
  try {
    const commits = session.commits
      .all()
      .filter((view) => !isTerminalCommit(view));
    if (flags.json) return commits.forEach(json);
    if (!commits.length) return out("Nothing to sign or approve");
    for (const view of commits)
      out(
        `${view.commit_id}  ${view.chain_family} · ${view.state} · ${view.signer}`,
      );
  } finally {
    session.close();
  }
}

export async function review(flags: Flags, ref: string): Promise<void> {
  const handle = await open(await connect(flags), ref);
  try {
    const card = new Card(handle.view, handle.review);
    if (flags.json)
      json({ ...handle.view, whole: card.whole, guard: card.guard });
    else [...card.lines, card.guard].forEach((line) => out(line));
  } finally {
    handle.close();
  }
}

type Decide = Flags & { yes?: boolean; version?: number };

/** Show the commit; one this card can't show whole is decided on its page. */
function shown(handle: CommitHandle): Card {
  const card = new Card(handle.view, handle.review);
  [...card.lines, card.guard].forEach((line) => err(line));
  if (!card.whole)
    throw new CliError(
      `Review this on the sign page: ${card.view.sign_url}`,
      3,
    );
  return card;
}

/** A yes to the version drawn: a person's, or --yes for the one it names. */
async function agreed(flags: Decide, verb: string, card: Card): Promise<void> {
  const { version } = card.view;
  if (flags.yes && flags.version === undefined)
    throw usage("--yes needs --version <n>, as aomi tx review --json shows it");
  if (flags.version !== undefined && flags.version !== version)
    throw new CliError(`It is at version ${version} now; review it again`);
  if (!flags.yes && !(await confirm(`${verb}${card.scope}?`)))
    throw new CliError(`Did not ${verb.toLowerCase()}`);
}

/** Decide exactly what was shown: by its ref, every write names its version. */
export async function act(
  aomi: Aomi,
  view: CommitRefView,
  how: "approve" | "sign" | "reject",
): Promise<CommitRefView> {
  const handle = await open(aomi, view.commit_id);
  try {
    if (handle.view.version !== view.version)
      throw new CommitStaleError(
        "commit_version_conflict",
        "It changed; review it again",
      );
    if (how === "reject") return await handle.reject();
    if (how === "approve") return await handle.approve(view);
    return await handle.sign(undefined, {
      expectedVersion: view.version,
      expectedReviewDigest: view.review?.digest,
    });
  } catch (error) {
    if (error instanceof CommitApprovalForbiddenError)
      throw new CliError(
        `This sign-in can't approve it; approve at ${view.sign_url}`,
        3,
      );
    if (error instanceof CommitExpiredError)
      throw new CliError("Expired · nothing was signed");
    throw error;
  } finally {
    handle.close();
  }
}

/** Approve a commit parked for you; Aomi then signs with the agent wallet. */
export async function approve(
  flags: Decide & { wait?: boolean },
  ref: string,
): Promise<void> {
  const aomi = await connect(flags);
  const handle = await open(aomi, ref);
  try {
    const { view } = handle;
    if (view.state !== "awaiting_approval")
      throw new CliError(
        `This commit isn't waiting for approval (${view.state})`,
      );
    if (view.can_approve === false)
      throw new CliError(
        `This sign-in can't approve this wallet's trades; approve at ${view.sign_url}`,
        3,
      );
    const card = shown(handle);
    await agreed(flags, "Approve", card);
    await act(aomi, card.view, "approve");
    if (flags.wait === false) return out("Approved · Aomi is signing");
    err("Approved · signing…");
    finish(flags, await follow(handle));
  } finally {
    handle.close();
  }
}

export async function reject(flags: Decide, ref: string): Promise<void> {
  const aomi = await connect(flags);
  const handle = await open(aomi, ref);
  try {
    const card = shown(handle);
    await agreed(flags, "Reject", card);
    const view = await act(aomi, card.view, "reject");
    if (flags.json) json(view);
    else out(outcome(view));
  } finally {
    handle.close();
  }
}

/** Sign with the local signer what was shown. */
export async function sign(flags: Decide, ref: string): Promise<void> {
  const aomi = await connect(flags);
  const handle = await open(aomi, ref);
  try {
    if (handle.state === "awaiting_approval")
      throw new CliError(`It waits for approval: aomi tx approve ${ref}`, 3);
    const card = shown(handle);
    if (!handle.canSign())
      throw new CliError(
        `No local signer for it: pass --private-key or --solana-private-key, aomi wallets signer set, or sign at ${handle.signUrl}`,
        3,
      );
    await agreed(flags, "Sign", card);
    await rpcReady(aomi, flags, card.view, (chain) =>
      ask(
        `RPC URL for ${chain} (this Aomi is not production): `,
        `No RPC for ${chain}: pass --rpc-url`,
      ),
    );
    await act(aomi, card.view, "sign");
    finish(flags, await follow(handle));
  } finally {
    handle.close();
  }
}

/** The exact reviewed commit, for an external signer. */
export async function exportCommit(flags: Flags, ref: string): Promise<void> {
  const handle = await open(await connect(flags), ref);
  try {
    json({ format: "aomi.commit.v1", commit: handle.view }, 2);
  } finally {
    handle.close();
  }
}
