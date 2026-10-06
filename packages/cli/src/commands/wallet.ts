import type { Action } from "@aomi-labs/client";
import { isTerminalCommit, type CommitView } from "@aomi-labs/client";
import { CliSession } from "../cli-session";
import { CliExit, fatal } from "../errors";
import { printDataFileLocation, printJson } from "../output";
import type { CliConfig } from "../types";

export async function txCommand(config: CliConfig): Promise<void> {
  const cli = CliSession.load();
  if (!cli) {
    if (config.json) printJson({ active: false, actions: [], commits: [] });
    else {
      console.log("No active session");
      printDataFileLocation({ verbose: config.verbose });
    }
    return;
  }

  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    const actions = session.actions.all();
    const commits = session.commits.all();
    if (config.json) {
      printJson({ active: true, actions, commits });
      return;
    }
    if (actions.length === 0 && commits.length === 0) {
      console.log("No Actions or commits.");
      printDataFileLocation({ verbose: config.verbose });
      return;
    }
    for (const commit of commits) console.log(formatCommit(commit));
    for (const action of actions) console.log(formatAction(action));
    printDataFileLocation({ verbose: config.verbose });
  } finally {
    session.close();
  }
}

export async function signCommand(
  config: CliConfig,
  selectors: string[],
): Promise<void> {
  if (selectors.length === 0) {
    fatal(
      "Usage: aomi tx sign <commit-or-action-id> [<id> ...]\nRun `aomi tx list` to see pending commits and Actions.",
    );
  }
  if (new Set(selectors).size !== selectors.length) {
    fatal("Duplicate transaction IDs are not allowed.");
  }
  const cli = CliSession.load();
  if (!cli) fatal("No active session. Run `aomi chat` first.");
  cli.mergeConfig(config);
  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    const targets = selectors.map((selector) =>
      resolveTarget(session.commits.all(), session.actions.pending(), selector),
    );
    if (new Set(targets.map((target) => target.id)).size !== targets.length) {
      fatal("The same transaction was selected more than once.");
    }
    for (const target of targets) {
      if (target.kind === "commit") {
        const view = target.view;
        const review = session.commits.review(view.commit_id);
        if (!review)
          fatal(`Commit "${view.commit_id}" has no review to approve.`);
        const aa =
          view.action?.kind === "sign" &&
          view.action.payload.kind === "user_operation";
        if (config.execution && (config.execution === "aa" ? !aa : aa)) {
          fatal(
            "The requested execution mode does not match the prepared commit.",
          );
        }
        if (!session.commits.canExecute(view)) {
          fatal(
            `Commit "${view.commit_id}" cannot be executed with the current wallet.`,
          );
        }
        continue;
      }
      const action = target.action;
      const aa =
        action.request.type === "sign" &&
        action.request.chainFamily === "evm" &&
        action.request.executionKind === "erc4337" &&
        Boolean(action.request.operationId);
      if (config.execution && (config.execution === "aa" ? !aa : aa)) {
        fatal(
          "The requested execution mode does not match the prepared Action; prepare a new operation instead.",
        );
      }
      if (!session.actions.canExecute(action.id)) {
        fatal(missingCapability(action));
      }
    }
    for (const target of orderTargets(targets)) {
      if (target.kind === "commit") {
        const view = target.view;
        const predecessorId = view.batch?.predecessor_commit_id;
        if (predecessorId) {
          const predecessor = await session.commits.refresh(predecessorId);
          if (predecessor.state !== "confirmed") {
            fatal(
              `Commit "${view.commit_id}" waits for predecessor "${predecessorId}" (${predecessor.state}). Wait for confirmation, then rerun \`aomi tx sign ${view.commit_id}\`.`,
            );
          }
        }
        const review = session.commits.review(view.commit_id)!;
        console.log(formatCommit(view));
        console.log(JSON.stringify(review, null, 2));
        const resolved = await session.commits.execute(view.commit_id, {
          expectedVersion: view.version,
          expectedReviewDigest: view.review?.digest,
        });
        console.log(`✅ ${resolved.commit_id} ${resolved.state}`);
        continue;
      }
      const action = target.action;
      console.log(formatAction(action));
      const resolved = await session.actions.execute(action.id);
      console.log(`✅ ${resolved.id} ${resolved.state}`);
    }
  } catch (error) {
    if (error instanceof CliExit) throw error;
    fatal(
      `❌ Action failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    session.close();
  }
}

export async function rejectCommand(
  config: CliConfig,
  selectors: string[],
): Promise<void> {
  if (selectors.length === 0) {
    fatal("Usage: aomi tx reject <commit-or-action-id> [<id> ...]");
  }
  const cli = CliSession.load();
  if (!cli) fatal("No active session. Run `aomi chat` first.");
  cli.mergeConfig(config);
  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    const targets = selectors.map((selector) =>
      resolveTarget(session.commits.all(), session.actions.pending(), selector),
    );
    if (new Set(targets.map((target) => target.id)).size !== targets.length) {
      fatal("The same transaction was selected more than once.");
    }
    for (const target of orderTargets(targets)) {
      if (target.kind === "commit") {
        const resolved = await session.commits.reject(target.view.commit_id);
        console.log(`✅ ${resolved.commit_id} ${resolved.state}`);
      } else {
        const resolved = await session.actions.reject(
          target.action.id,
          "Request rejected",
        );
        console.log(`✅ ${resolved.id} ${resolved.state}`);
      }
    }
  } catch (error) {
    if (error instanceof CliExit) throw error;
    fatal(
      `❌ Rejection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    session.close();
  }
}

type Target =
  | { kind: "commit"; id: string; view: CommitView }
  | { kind: "action"; id: string; action: Action };

function orderTargets(targets: readonly Target[]): Target[] {
  const commits = targets.filter(
    (target): target is Extract<Target, { kind: "commit" }> =>
      target.kind === "commit",
  );
  const membership = new Map<string, { batchId: string; index: number }>();
  for (const target of commits) {
    const batch = target.view.batch;
    if (!batch) continue;
    batch.ordered_commit_ids.forEach((id, index) => {
      membership.set(id, { batchId: batch.batch_id, index });
    });
  }
  const rank = (target: Extract<Target, { kind: "commit" }>) =>
    membership.get(target.id) ?? { batchId: target.id, index: 0 };
  const batchOrder = new Map<string, number>();
  for (const target of commits) {
    const { batchId } = rank(target);
    if (!batchOrder.has(batchId)) batchOrder.set(batchId, batchOrder.size);
  }
  commits.sort((left, right) => {
    const leftRank = rank(left);
    const rightRank = rank(right);
    return (
      batchOrder.get(leftRank.batchId)! - batchOrder.get(rightRank.batchId)! ||
      leftRank.index - rightRank.index
    );
  });
  let commitIndex = 0;
  return targets.map((target) =>
    target.kind === "commit" ? commits[commitIndex++]! : target,
  );
}

function resolveTarget(
  commits: readonly CommitView[],
  actions: readonly Action[],
  selector: string,
): Target {
  const matches: Target[] = [
    ...commits
      .filter((view) => !isTerminalCommit(view) && view.action)
      .map((view): Target => ({ kind: "commit", id: view.commit_id, view })),
    ...actions.map(
      (action): Target => ({ kind: "action", id: action.id, action }),
    ),
  ].filter(
    (target) => target.id === selector || target.id.startsWith(selector),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1)
    fatal(`Transaction selector "${selector}" is ambiguous.`);
  fatal(`Pending commit or Action "${selector}" was not found.`);
}

function formatCommit(view: CommitView): string {
  return `${isTerminalCommit(view) ? "✅" : "⏳"} ${view.commit_id}  ${view.chain_family.toUpperCase()} commit · ${view.signer}  (${view.state}, version ${view.version})`;
}

function formatAction(action: Action): string {
  const request = action.request;
  const detail =
    request.type === "execute_evm"
      ? `${request.transactions.length} EVM transaction${request.transactions.length === 1 ? "" : "s"}`
      : request.type === "execute_svm"
        ? `${request.transactions.length} SVM transaction${request.transactions.length === 1 ? "" : "s"}`
        : `${request.chainFamily.toUpperCase()} signature`;
  const funding =
    request.type === "sign" && request.maxNetworkFee
      ? ` · network ceiling ${request.maxNetworkFee} native base units (${request.sponsorship === "required" ? "sponsorship required" : "user-funded"})`
      : "";
  return `${action.state === "pending" ? "⏳" : "✅"} ${action.id}  ${detail}${funding}  (${action.state}, revision ${action.revision})`;
}

function missingCapability(action: Action): string {
  if (
    action.request.type === "execute_svm" ||
    (action.request.type === "sign" && action.request.chainFamily === "svm")
  ) {
    return "A Solana key is required. Run `aomi wallet set --solana <key>` or pass --solana-private-key.";
  }
  return "An EVM private key is required. Run `aomi wallet set <hex-key>` or pass --private-key.";
}
