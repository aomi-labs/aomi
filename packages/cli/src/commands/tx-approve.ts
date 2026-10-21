import { createInterface } from "node:readline/promises";
import {
  AomiCommits,
  CommitApprovalForbiddenError,
  CommitExpiredError,
  CommitNotAwaitingApprovalError,
  CommitNotFoundError,
  CommitStaleError,
  isTerminalCommit,
  type CommitHandle,
  type CommitRefView,
} from "@aomi-labs/client";
import { CliSession } from "../cli-session";
import { fatal } from "../errors";
import { printJson } from "../output";
import type { CliConfig } from "../types";
import { formatCommitRef } from "./tx-show";

export type TxApproveOptions = { yes?: boolean; noWait?: boolean };
export type TxApproveTiming = { intervalMs: number; timeoutMs: number };

const DEFAULT_TIMING: TxApproveTiming = {
  intervalMs: 2000,
  timeoutMs: 120_000,
};

/** The backend decides who approves; `view.can_approve` says whether this login may. */
export function loginHint(signUrl?: string): string {
  return `This terminal can't approve trades. Turn on "Can approve trades" for it in Aomi Settings › Connections${signUrl ? `, or approve at ${signUrl}` : ""}.`;
}

export function notAwaitingMessage(state: string): string {
  return `This commit isn't waiting for approval (state: ${state}).`;
}

async function askApprove(json: boolean | undefined): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: json ? process.stderr : process.stdout,
  });
  try {
    return /^y(es)?$/i.test((await rl.question("Approve? [y/N] ")).trim());
  } finally {
    rl.close();
  }
}

/** One line for where the commit ended up. */
function outcomeLine(view: CommitRefView): string {
  if (view.state === "confirmed")
    return `Confirmed · ${view.transaction_url ?? view.transaction_id ?? "no transaction id"}`;
  if (isTerminalCommit(view))
    return `${view.state[0]!.toUpperCase()}${view.state.slice(1)} · ${view.failure_code ?? "no failure code"}`;
  const tx = view.transaction_url ?? view.transaction_id;
  return `Still ${view.state}${tx ? ` · ${tx}` : ""}; run \`aomi tx show ${view.commit_id}\` to check.`;
}

/** Wait until every member of the batch is terminal, or the timeout. */
async function waitForOutcome(
  handle: CommitHandle,
  timing: TxApproveTiming,
): Promise<CommitRefView> {
  const deadline = Date.now() + timing.timeoutMs;
  while (!handle.settled.done && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, timing.intervalMs));
    await handle.refresh();
  }
  const { done, failed, last } = handle.settled;
  // The member that did not confirm, else the last one; a pending batch
  // reports where its first unfinished member is.
  return done
    ? (failed ?? last)
    : (handle.batch.find((view) => !isTerminalCommit(view)) ?? handle.view);
}

/** `aomi tx approve <ref>`: approve a parked agent-wallet commit, then follow it. */
export async function txApproveCommand(
  config: CliConfig,
  ref: string,
  options: TxApproveOptions = {},
  timing: TxApproveTiming = DEFAULT_TIMING,
): Promise<void> {
  if (!ref) fatal("Usage: aomi tx approve <ref> [--yes] [--no-wait]");
  const cli = CliSession.load();
  if (!cli)
    fatal("No active session. Run `aomi chat` or `aomi account login` first.");
  cli.mergeConfig(config);
  // With --json, stdout carries only the final view.
  const say = config.json ? console.error : console.log;
  const session = cli.createClientSession(config);
  try {
    let handle: CommitHandle;
    try {
      handle = await new AomiCommits(session.client).get(ref);
    } catch (error) {
      if (error instanceof CommitNotFoundError)
        fatal(`Commit "${ref}" was not found for this account.`);
      throw error;
    }
    try {
      const view = handle.view;
      if (view.state !== "awaiting_approval")
        fatal(notAwaitingMessage(view.state));
      if (view.can_approve === false) fatal(loginHint(view.sign_url));

      say(formatCommitRef(view, handle.review));
      if (!options.yes) {
        if (!process.stdin.isTTY)
          fatal("Refusing to approve without --yes outside a terminal.");
        if (!(await askApprove(config.json))) fatal("Not approved.");
      }

      let approved: CommitRefView;
      try {
        approved = await handle.approve();
      } catch (error) {
        if (error instanceof CommitApprovalForbiddenError)
          fatal(loginHint(view.sign_url));
        if (error instanceof CommitExpiredError)
          fatal("Expired · nothing was signed");
        if (error instanceof CommitStaleError)
          fatal(`This commit changed; run \`aomi tx show ${ref}\`.`);
        if (error instanceof CommitNotAwaitingApprovalError) {
          const current = await handle.refresh().catch(() => handle.view);
          fatal(notAwaitingMessage(current.state));
        }
        throw error;
      }

      if (options.noWait) {
        if (config.json) printJson(approved);
        else
          console.log(
            `Approved · Aomi is signing. Check with \`aomi tx show ${ref}\`.`,
          );
        return;
      }
      say("Approved · signing…");
      const final = await waitForOutcome(handle, timing);
      if (config.json) printJson(final);
      else console.log(outcomeLine(final));
    } finally {
      handle.close();
    }
  } finally {
    session.close();
  }
}
