import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CommitApprovalForbiddenError,
  CommitExpiredError,
  CommitNotFoundError,
  CommitStaleError,
  isTerminalCommit,
  type Aomi,
  type CommitHandle,
  type CommitRefView,
  type CommitReview,
} from "@aomi-labs/client";
import {
  CliError,
  confirm,
  connect,
  err,
  json,
  out,
  usage,
  type ConnectFlags,
} from "../context";
import { loadState, STATE_DIR } from "../state";

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

/** One line for what the reviewed request does. */
export function reviewSummary(review: CommitReview | undefined): string {
  if (!review) return "no review";
  if (review.type === "sign")
    return (
      review.description ?? `${review.chainFamily.toUpperCase()} signature`
    );
  const count = review.transactions.length;
  const labels = review.transactions.flatMap((transaction) =>
    "label" in transaction && typeof transaction.label === "string"
      ? [transaction.label]
      : [],
  );
  const simulation = review.simulation?.status
    ? ` · simulation ${review.simulation.status}`
    : "";
  return `${count} ${review.type === "execute_evm" ? "EVM" : "SVM"} transaction${count === 1 ? "" : "s"}${labels.length ? `: ${labels.join("; ")}` : ""}${simulation}`;
}

export function reviewLines(
  view: CommitRefView,
  review: CommitReview | undefined,
): string[] {
  const rows: [string, string][] = [
    ["Commit", view.commit_id],
    ["State", `${view.state} (version ${view.version})`],
    ["Chain", `${view.chain_family}:${view.chain_ref}`],
    ["Signer", view.signer],
    [
      "Origin",
      `${view.origin}${view.origin_app !== null ? ` (app ${view.origin_app})` : ""} · initiated by ${view.initiator}`,
    ],
    ["Review", reviewSummary(review)],
  ];
  if (view.transaction_id)
    rows.push(["Transaction", view.transaction_url ?? view.transaction_id]);
  rows.push(["Sign URL", view.sign_url]);
  return rows.map(([label, value]) => `${label.padEnd(11)}  ${value}`);
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
export async function follow(
  handle: CommitHandle,
  sign = false,
): Promise<CommitRefView> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (!handle.settlement.done && Date.now() < deadline) {
    const next = handle.next;
    if (sign && next.view.action && next.canSign()) await next.sign();
    else await new Promise((resolve) => setTimeout(resolve, 1000));
    await handle.refresh();
  }
  const { done, failed, last } = handle.settlement;
  return done ? (failed ?? last) : handle.next.view;
}

function finish(flags: Flags, view: CommitRefView) {
  if (flags.json) json(view);
  else out(outcome(view));
  if (isTerminalCommit(view) && view.state !== "confirmed")
    process.exitCode = 1;
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
    if (flags.json)
      json({ ...handle.view, review_summary: reviewSummary(handle.review) });
    else reviewLines(handle.view, handle.review).forEach((line) => out(line));
  } finally {
    handle.close();
  }
}

/** Approve a commit parked for you; Aomi then signs with the agent wallet. */
export async function approve(
  flags: Flags & { yes?: boolean; wait?: boolean },
  ref: string,
): Promise<void> {
  const handle = await open(await connect(flags), ref);
  try {
    const view = handle.view;
    if (view.state !== "awaiting_approval")
      throw new CliError(
        `This commit isn't waiting for approval (${view.state})`,
      );
    if (view.can_approve === false)
      throw new CliError(
        `This sign-in can't approve this wallet's trades; approve at ${view.sign_url}`,
        3,
      );
    reviewLines(view, handle.review).forEach((line) => err(line));
    if (!flags.yes && !(await confirm("Approve?")))
      throw new CliError("Not approved");
    try {
      await handle.approve(view);
    } catch (error) {
      if (error instanceof CommitApprovalForbiddenError)
        throw new CliError(
          `This sign-in can't approve it; approve at ${view.sign_url}`,
          3,
        );
      if (error instanceof CommitExpiredError)
        throw new CliError("Expired · nothing was signed");
      if (error instanceof CommitStaleError)
        throw new CliError(`It changed; aomi tx review ${ref}`);
      throw error;
    }
    if (flags.wait === false) return out("Approved · Aomi is signing");
    err("Approved · signing…");
    finish(flags, await follow(handle));
  } finally {
    handle.close();
  }
}

export async function reject(flags: Flags, ref: string): Promise<void> {
  const handle = await open(await connect(flags), ref);
  try {
    finish(flags, await handle.reject());
  } finally {
    handle.close();
  }
}

/** The commit `ref` with the local signer, its EVM key on the commit's chain
 * rather than the saved default. */
export async function signable(
  flags: ConnectFlags,
  ref: string,
): Promise<CommitHandle> {
  const handle = await open(await connect(flags), ref);
  const chain = Number(handle.view.chain_ref);
  if (
    handle.view.chain_family !== "evm" ||
    flags.chain !== undefined ||
    chain === (loadState().chain ?? 1)
  )
    return handle;
  handle.close();
  return open(await connect({ ...flags, chain }), ref);
}

/** Sign with the local signer, every member of the batch in order. */
export async function sign(flags: Flags, ref: string): Promise<void> {
  const handle = await signable(flags, ref);
  try {
    if (handle.state === "awaiting_approval")
      throw new CliError(`It waits for approval: aomi tx approve ${ref}`, 3);
    if (!handle.next.canSign())
      throw new CliError(
        "No local signer for it: pass --private-key or --solana-private-key, or aomi wallets signer set",
        3,
      );
    reviewLines(handle.view, handle.review).forEach((line) => err(line));
    finish(flags, await follow(handle, true));
  } finally {
    handle.close();
  }
}

/** `aomi.commit.v1`: the reviewed commit and, for a Solana transaction, its
 * unsigned wire bytes as base64. */
export function exportJson(view: CommitRefView): string {
  const payload =
    view.action && "payload" in view.action ? view.action.payload : null;
  const unsigned =
    payload?.kind === "svm_transaction" ? payload.transaction_base64 : null;
  return JSON.stringify(
    {
      format: "aomi.commit.v1",
      commit: view,
      unsigned_transaction_base64: unsigned,
    },
    null,
    2,
  );
}

/** Write the export to ~/.aomi/exports/<ref>.json; returns its path. */
export function saveExport(view: CommitRefView): string {
  const dir = join(STATE_DIR, "exports");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${view.commit_id}.json`);
  writeFileSync(path, `${exportJson(view)}\n`, { mode: 0o600 });
  return path;
}

/** The exact reviewed commit, for an external signer. */
export async function exportCommit(flags: Flags, ref: string): Promise<void> {
  const handle = await open(await connect(flags), ref);
  try {
    out(exportJson(handle.view));
  } finally {
    handle.close();
  }
}
