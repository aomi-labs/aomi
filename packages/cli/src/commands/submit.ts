import { readFileSync } from "node:fs";

import { isTerminalCommit, type CommitView } from "../../commits";
import { CliSession } from "../cli-session";
import { CliExit, fatal } from "../errors";
import { printJson } from "../output";
import type { CliConfig } from "../types";

type SignedArtifact = {
  format: "aomi.commit.v1";
  commit: CommitView;
  payloads: string[];
};

/** Report an external signer's result against an unchanged durable review. */
export async function submitCommand(
  config: CliConfig,
  selector: string,
  options: { signedFile?: string; txHash?: string },
): Promise<void> {
  if (!selector || Boolean(options.signedFile) === Boolean(options.txHash)) {
    fatal(
      "Usage: aomi tx submit <commit-id> (--signed-file <path> | --tx-hash <hash>)",
    );
  }
  const cli = CliSession.load();
  if (!cli) fatal("No active session. Run `aomi chat` first.");
  cli.mergeConfig(config);
  const session = cli.createClientSession(config);
  try {
    await session.fetchCurrentState();
    const view = resolveCommit(
      session.commits.all(),
      selector,
      Boolean(options.txHash),
    );
    const review = {
      expectedVersion: view.version,
      expectedReviewDigest: view.review?.digest,
    };
    let resolved: CommitView;
    if (options.signedFile) {
      if (!session.commits.review(view.commit_id) || !view.review?.digest) {
        throw new Error(`Commit "${view.commit_id}" has no durable review.`);
      }
      if (view.action?.kind !== "sign") {
        throw new Error(
          `Commit "${view.commit_id}" is not awaiting signatures.`,
        );
      }
      const artifact = readSignedArtifact(options.signedFile);
      if (canonicalJson(artifact.commit) !== canonicalJson(view)) {
        throw new Error(
          "Signed file does not match the current exact commit; export and review it again.",
        );
      }
      resolved = await session.commits.submitSigned(
        view.commit_id,
        artifact.payloads,
        review,
      );
    } else {
      const settled = view.state === "submitted" || view.state === "confirmed";
      if (
        !settled &&
        (!session.commits.review(view.commit_id) || !view.review?.digest)
      ) {
        throw new Error(`Commit "${view.commit_id}" has no durable review.`);
      }
      if (!settled && view.action?.kind !== "broadcast") {
        throw new Error(
          `Commit "${view.commit_id}" is not awaiting broadcast.`,
        );
      }
      const expectedHash = settled
        ? view.transaction_id
        : view.action?.kind === "broadcast"
          ? view.action.transaction_id
          : null;
      if (!expectedHash || options.txHash !== expectedHash) {
        throw new Error("Transaction hash does not match the prepared commit.");
      }
      resolved = await session.commits.submitBroadcast(
        view.commit_id,
        options.txHash!,
        review,
      );
    }
    if (config.json) printJson(resolved);
    else console.log(`✅ ${resolved.commit_id} ${resolved.state}`);
  } catch (error) {
    if (error instanceof CliExit) throw error;
    fatal(
      `❌ Commit submission failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    session.close();
  }
}

function resolveCommit(
  commits: readonly CommitView[],
  selector: string,
  allowConfirmed: boolean,
): CommitView {
  const matches = commits.filter(
    (view) =>
      (!isTerminalCommit(view) ||
        (allowConfirmed && view.state === "confirmed")) &&
      (view.commit_id === selector || view.commit_id.startsWith(selector)),
  );
  if (matches.length > 1)
    throw new Error(`Commit selector "${selector}" is ambiguous.`);
  const view = matches[0];
  if (!view) throw new Error(`Commit "${selector}" was not found.`);
  return view;
}

function readSignedArtifact(path: string): SignedArtifact {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read signed commit file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!value || typeof value !== "object") {
    throw new Error("Signed commit file must contain a JSON object.");
  }
  const artifact = value as Partial<SignedArtifact>;
  if (
    artifact.format !== "aomi.commit.v1" ||
    !artifact.commit ||
    typeof artifact.commit !== "object" ||
    !Array.isArray(artifact.payloads) ||
    artifact.payloads.some((payload) => typeof payload !== "string" || !payload)
  ) {
    throw new Error(
      "Signed commit file must be an aomi.commit.v1 export with a payloads array.",
    );
  }
  return artifact as SignedArtifact;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
