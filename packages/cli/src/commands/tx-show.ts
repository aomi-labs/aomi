import {
  AomiCommits,
  CommitNotFoundError,
  type CommitRefView,
  type CommitReview,
} from "@aomi-labs/client";
import { CliSession } from "../cli-session";
import { fatal } from "../errors";
import { printJson } from "../output";
import type { CliConfig } from "../types";

/** One line describing what the reviewed request does. */
export function reviewSummary(review: CommitReview | undefined): string {
  if (!review) return "no review";
  if (review.type === "sign")
    return (
      review.description ?? `${review.chainFamily.toUpperCase()} signature`
    );
  const family = review.type === "execute_evm" ? "EVM" : "SVM";
  const count = review.transactions.length;
  const labels = review.transactions
    .map((transaction) =>
      "label" in transaction && typeof transaction.label === "string"
        ? transaction.label
        : undefined,
    )
    .filter(Boolean);
  const simulation = review.simulation?.status
    ? ` · simulation ${review.simulation.status}`
    : "";
  return `${count} ${family} transaction${count === 1 ? "" : "s"}${labels.length ? `: ${labels.join("; ")}` : ""}${simulation}`;
}

export function formatCommitRef(
  view: CommitRefView,
  review: CommitReview | undefined,
): string {
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
    ...(view.transaction_id
      ? [
          ["Transaction", view.transaction_url ?? view.transaction_id] as [
            string,
            string,
          ],
        ]
      : []),
    ["Sign URL", view.sign_url],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(([label, value]) => `${label.padEnd(width)}  ${value}`)
    .join("\n");
}

/** `aomi tx show <ref>`: one commit by ref, through the SDK's commits.get. */
export async function txShowCommand(
  config: CliConfig,
  ref: string,
): Promise<void> {
  if (!ref) fatal("Usage: aomi tx show <ref>");
  const cli = CliSession.load();
  if (!cli)
    fatal("No active session. Run `aomi chat` or `aomi account login` first.");
  cli.mergeConfig(config);
  const session = cli.createClientSession(config);
  try {
    let handle;
    try {
      handle = await new AomiCommits(session.client).get(ref);
    } catch (error) {
      if (error instanceof CommitNotFoundError)
        fatal(`Commit "${ref}" was not found for this account.`);
      throw error;
    }
    try {
      if (config.json)
        printJson({
          ...handle.view,
          review_summary: reviewSummary(handle.review),
        });
      else console.log(formatCommitRef(handle.view, handle.review));
    } finally {
      handle.close();
    }
  } finally {
    session.close();
  }
}
