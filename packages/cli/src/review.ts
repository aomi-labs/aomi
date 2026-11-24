import {
  isMessageReview,
  reviewEligibility,
  shortAddress,
  type CommitReview,
  type CommitView,
  type MessageReviewRow,
  type MessageCommitReview,
} from "@aomi-labs/client";
import { formatUnits } from "viem";
import { plain } from "./trace";

type Execute = Extract<CommitReview, { type: "execute_evm" | "execute_svm" }>;
type Asset = {
  asset: string;
  symbol?: string | null;
  decimals?: number | null;
  tokenId?: string | null;
};

/** `2 USDC (0x8335…2913)`: a symbol is what its contract says, so the address stays. */
function amountOf(
  token: Asset,
  amount: string | null | undefined,
  svm: boolean,
): string {
  const native = token.asset === "native";
  const decimals = token.decimals ?? (native ? (svm ? 9 : 18) : undefined);
  const shown =
    !amount || token.tokenId
      ? ""
      : decimals === undefined || !/^\d+$/.test(amount)
        ? `${amount}${amount.includes(".") ? "" : " raw"} `
        : `${formatUnits(BigInt(amount), decimals)} `;
  const symbol = token.symbol?.trim() || (native ? "native token" : "token");
  return `${shown}${symbol}${token.tokenId ? ` #${token.tokenId}` : ""}${native ? "" : ` (${shortAddress(token.asset)})`}`;
}

/** The steps in order: a label is `<title>\n<decoded call>`. */
function stepLines(request: Execute, details: boolean): string[] {
  if (request.type === "execute_svm")
    return request.transactions.flatMap((tx, index) => [
      `${index + 1}. ${tx.description}`,
      `   programs ${[...new Set(tx.instructions.map((ix) => ix.program_id))].join(", ")}`,
    ]);
  return request.transactions.flatMap((tx, index) => {
    const [title = tx.kind, ...call] = tx.label.split(/\s*\n\s*/u);
    const value = /^(0x0*|0*)$/.test(tx.value ?? "") ? undefined : tx.value;
    return [
      `${index + 1}. ${title}`,
      ...call.map((line) => `   ${line}`),
      `   to ${tx.to}${value ? ` · sends ${formatUnits(BigInt(value), 18)} native token` : ""}`,
      ...(details
        ? [
            `   data ${tx.data.slice(0, 10)}… (${Math.max(0, tx.data.length - 2) / 2} bytes)`,
          ]
        : []),
    ];
  });
}

/** What the signing wallet gains, loses and allows, as simulated. */
function effectLines(request: Execute, signer: string): string[] {
  const svm = request.type === "execute_svm";
  const { simulation } = request;
  const same = (account?: string | null) =>
    !account ||
    (svm ? account === signer : account.toLowerCase() === signer.toLowerCase());
  const fee = simulation.fees[0];
  return [
    ...simulation.balanceChanges
      .filter((change) => same(change.account) && change.direction)
      .map(
        (change) =>
          `${change.direction === "in" ? "+ receive" : "- send"} ${amountOf(change, change.amount, svm)}`,
      ),
    ...simulation.approvals
      .filter((approval) => same(approval.account))
      .map((approval) =>
        approval.approved === false || approval.amount === "0"
          ? `revoke ${approval.spender}'s access to ${amountOf(approval, null, svm)}`
          : `! allow ${approval.spender} to spend ${approval.unlimited ? "unlimited " : approval.kind === "operator" ? "every " : ""}${amountOf(approval, approval.unlimited ? null : approval.amount, svm)}`,
      ),
    `Simulation ${simulation.status}${fee ? ` · ~${amountOf(fee, fee.amount, svm)} fee` : ""}`,
    ...simulation.warnings.map((warning) => `! ${warning}`),
  ];
}

function rowLine(
  row: MessageReviewRow,
  tokens: NonNullable<MessageCommitReview["messageReview"]>["tokens"],
): string {
  if (row.kind === "text") return row.text;
  if (row.kind === "sign_in")
    return `Sign in to ${row.domain}${row.statement ? `: ${row.statement}` : ""}`;
  const token = Object.entries(tokens ?? {}).find(
    ([address]) => address.toLowerCase() === row.token.toLowerCase(),
  )?.[1];
  const what = (amount: string | null) =>
    amountOf({ asset: row.token, ...token }, amount, false);
  if (row.kind === "sell") return `- sell ${what(row.amount)}`;
  if (row.kind === "receive")
    return `+ receive ${row.minimum ? "at least " : ""}${what(row.amount)}`;
  return `! allow ${row.spender} to spend ${row.unlimited ? `unlimited ${what(null)}` : what(row.amount)}${row.expires_at ? ` until ${new Date(row.expires_at * 1000).toISOString()}` : ""}`;
}

/** Whether guards cover the request, and why not when they don't. */
export function guardLine(review: CommitReview | undefined): string {
  const eligibility = reviewEligibility(review);
  const reason = plain(eligibility?.reason ?? "no reason given");
  if (eligibility?.state === "blocked") return `Blocked: ${reason}`;
  if (eligibility?.state === "unresolved") return `Not cleared: ${reason}`;
  const coverage = review?.transactionSafety?.assessment.coverage;
  if (!coverage) return "Guard coverage not reported";
  return coverage === "supported"
    ? "Covered by guards"
    : `Partly covered: ${reason}`;
}

/**
 * What a commit does, as a person reads it before deciding: its steps or its
 * message, what they change, and what the guards found. `details` adds what
 * the decoded lines summarize.
 */
export function cardLines(
  view: CommitView,
  review: CommitReview | undefined,
  details = true,
): string[] {
  const safety = review?.transactionSafety;
  const lines: string[] = [];
  if (!review)
    lines.push(
      "No decoded review; the exact request:",
      JSON.stringify(view.action),
    );
  else if (review.type === "sign") {
    const message = isMessageReview(review) ? review.messageReview : undefined;
    lines.push(
      review.description,
      ...(message?.rows ?? []).map((row) => rowLine(row, message?.tokens)),
      ...(message?.warning ? [`! ${message.warning}`] : []),
    );
    // Rows summarize the message; without any, it is all there is to read.
    if (details || !message?.rows.length)
      for (const payload of review.payloads)
        lines.push(
          ...(payload.kind === "evm_personal"
            ? payload.message
            : JSON.stringify(payload, null, 2)
          ).split("\n"),
        );
  } else
    lines.push(
      ...stepLines(review, details),
      ...effectLines(review, view.signer),
    );
  for (const finding of safety?.assessment.findings ?? [])
    if (finding.severity !== "info")
      lines.push(
        `! ${finding.message}${safety!.decision.bypassedFindingIds.includes(finding.id) ? " (let through)" : ""}`,
      );
  return lines.map(plain);
}
