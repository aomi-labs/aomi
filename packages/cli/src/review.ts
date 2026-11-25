import {
  CHAIN_NAMES,
  isMessageReview,
  reviewEligibility,
  type CommitRefView,
  type CommitReview,
  type MessageCommitReview,
  type MessageReviewRow,
} from "@aomi-labs/client";
import { formatUnits, hexToBytes, isHex, parseUnits } from "viem";
import { evmCall, svmCall } from "./calls";
import { plain } from "./trace";

type Execute = Extract<CommitReview, { type: "execute_evm" | "execute_svm" }>;
type Payload = MessageCommitReview["payloads"][number];
type Asset = {
  asset: string;
  symbol?: string | null;
  decimals?: number | null;
  standard?: string | null;
  tokenId?: string | null;
  uiMultiplier?: string;
};

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

/** The commit itself: where it stands, its chain and who signs. */
function metaLines(view: CommitRefView): string[] {
  const rows: [string, string | undefined][] = [
    ["Commit", view.commit_id],
    ["State", `${view.state} (version ${view.version})`],
    [
      "Chain",
      `${view.chain_family}:${view.chain_ref}${view.chain_family === "evm" ? ` ${CHAIN_NAMES[Number(view.chain_ref)] ?? ""}` : ""}`,
    ],
    ["Signer", view.signer],
    [
      "Origin",
      view.origin && `${view.origin} · initiated by ${view.initiator}`,
    ],
    ["Transaction", view.transaction_url ?? view.transaction_id ?? undefined],
    ["Sign URL", view.sign_url],
  ];
  return rows.flatMap(([label, value]) =>
    value ? [`${label.padEnd(11)}  ${value.trim()}`] : [],
  );
}

/** Text as signed, with what a screen hides or reorders written out. */
const visible = (text: string) =>
  text.replace(/[\\\p{C}\p{Z}\u115f\u1160\u2800\u3164\uffa0]/gu, (char) =>
    char === " " || char === "\n"
      ? char
      : char === "\\"
        ? "\\\\"
        : `\\u{${char.codePointAt(0)!.toString(16)}}`,
  );

/** A message payload as signed, in full; throws on bytes that are no text. */
function payloadLines(payload: Payload): string[] {
  const text = (bytes: Uint8Array) =>
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (payload.kind === "svm_transaction") throw new Error("Not a message");
  const signed =
    payload.kind === "evm_typed_data"
      ? // With its types: only the fields they name are signed.
        JSON.stringify(payload.typed_data, null, 2)
      : payload.kind === "svm_message"
        ? text(Buffer.from(payload.message_base64, "base64"))
        : isHex(payload.message)
          ? text(hexToBytes(payload.message))
          : payload.message;
  return visible(signed).split("\n");
}

/**
 * What one decision covers, as a person reads it before making it. Only a
 * `whole` card may be decided here: it shows every step from its bytes, every
 * amount and fee, and the full message. Anything else is for the sign page.
 */
export class Card {
  readonly lines: string[] = [];
  readonly guard: string;
  /** How many commits the decision is for. */
  readonly count: number;
  whole = true;

  constructor(
    readonly view: CommitRefView,
    review: CommitReview | undefined,
  ) {
    this.guard = guardLine(review);
    this.count = view.batch?.ordered_commit_ids.length ?? 1;
    if (this.count > 1) this.lines.push(`Decides all ${this.count}, in order`);
    // A local key signs a batch one by one, at versions and fees not set yet.
    if (this.count > 1 && view.state !== "awaiting_approval") this.missing();
    try {
      if (!review) this.missing();
      else if (review.type === "sign") this.message(review);
      else this.execution(review);
    } catch {
      this.missing();
    }
    const safety = review?.transactionSafety;
    for (const finding of safety?.assessment.findings ?? [])
      if (finding.severity !== "info")
        this.lines.push(
          `! ${finding.message}${safety!.decision.bypassedFindingIds.includes(finding.id) ? " (let through)" : ""}`,
        );
    if (!this.whole) this.lines.push("! Review this on the sign page");
    this.lines = [...metaLines(view), ...this.lines].map(plain);
  }

  /** `all 3` for a batch. */
  get scope(): string {
    return this.count > 1 ? ` all ${this.count}` : "";
  }

  /** Something the decision covers isn't shown. */
  private missing(text?: string): string {
    this.whole = false;
    return text ?? "";
  }

  private named({ asset, symbol, tokenId }: Asset): string {
    const native = asset === "native";
    const name = symbol?.trim() || (native ? "native token" : "token");
    // A symbol is what its contract says, so the address stays.
    return `${name}${tokenId ? ` #${tokenId}` : ""}${native ? "" : ` (${asset})`}`;
  }

  private amount(
    token: Asset,
    raw: string | null | undefined,
    svm: boolean,
  ): string {
    const decimals =
      token.decimals ??
      (token.tokenId ? 0 : token.asset === "native" ? (svm ? 9 : 18) : null);
    const value = raw ?? (token.standard === "erc721" ? "1" : "");
    if (decimals === null || !/^\d+$/.test(value))
      return this.missing(`${value || "?"} raw ${this.named(token)}`);
    const units = formatUnits(BigInt(value), decimals);
    if (!token.uiMultiplier) return `${units} ${this.named(token)}`;
    const scaled =
      (BigInt(value) * parseUnits(token.uiMultiplier, 18)) / 10n ** 18n;
    return `${formatUnits(scaled, decimals)} ${this.named(token)}, ${units} before its ×${token.uiMultiplier} scaling`;
  }

  private message(review: Extract<CommitReview, { type: "sign" }>) {
    const { messageReview: message } = review;
    if (!isMessageReview(review) || !review.payloads.length) this.missing();
    const row = (entry: MessageReviewRow): string => {
      if (entry.kind === "text") return entry.text;
      if (entry.kind === "sign_in")
        return `Sign in to ${entry.domain}${entry.statement ? `: ${entry.statement}` : ""}`;
      const token = Object.entries(message?.tokens ?? {}).find(
        ([address]) => address.toLowerCase() === entry.token.toLowerCase(),
      )?.[1];
      const asset = { asset: entry.token, ...token };
      const what = () => this.amount(asset, entry.amount, false);
      if (entry.kind === "sell") return `- sell ${what()}`;
      if (entry.kind === "receive")
        return `+ receive ${entry.minimum ? "at least " : ""}${what()}`;
      return `! allow ${entry.spender} to spend ${entry.unlimited ? `unlimited ${this.named(asset)}` : what()}${entry.expires_at ? ` until ${date(entry.expires_at)}` : ""}`;
    };
    this.lines.push(
      review.description,
      ...(message?.rows ?? []).map(row),
      ...(message?.warning ? [`! ${message.warning}`] : []),
      ...(message?.expires_at ? [`Expires ${date(message.expires_at)}`] : []),
      "You sign:",
      ...review.payloads.flatMap(payloadLines),
    );
  }

  private execution(request: Execute) {
    if (request.transactions.length !== this.count) this.missing();
    if (request.type === "execute_evm")
      request.transactions.forEach((tx, index) => {
        const value = BigInt(tx.value || 0);
        const call = /^(0x)?$/.test(tx.data)
          ? "no call data"
          : (evmCall(tx.data) ??
            this.missing(
              `call ${tx.data.slice(0, 10)} and ${Math.max(0, tx.data.length - 10) / 2} bytes not decoded here`,
            ));
        this.lines.push(
          `${index + 1}. ${tx.label.split("\n")[0]}`,
          `   to ${tx.to}`,
          `   ${call}`,
          ...(value ? [`   sends ${formatUnits(value, 18)} native token`] : []),
        );
      });
    else
      request.transactions.forEach((tx, index) => {
        if (!tx.instructions.length) this.missing();
        this.lines.push(`${index + 1}. ${tx.description.split("\n")[0]}`);
        for (const ix of tx.instructions) {
          const data = Buffer.from(ix.data_base64, "base64");
          const read = svmCall(ix.program_id, data);
          this.lines.push(
            `   ${read?.call ?? this.missing(`${data.length} bytes not decoded here`)} on ${ix.program_id}`,
            ...ix.accounts.map(
              (account, at) =>
                `     ${read?.roles[at] || "account"} ${account.pubkey}`,
            ),
          );
        }
      });
    this.effects(request);
    this.fees(request);
  }

  /** What the signing wallet gains, loses and allows, as simulated. */
  private effects({ type, simulation }: Execute) {
    const svm = type === "execute_svm";
    const { signer } = this.view;
    const own = ({ account }: { account?: string | null }) =>
      !account ||
      (svm
        ? account === signer
        : account.toLowerCase() === signer.toLowerCase());
    for (const change of simulation.balanceChanges.filter(own))
      this.lines.push(
        `${change.direction === "in" ? "+ receive" : change.direction === "out" ? "- send" : this.missing("? move")} ${this.amount(change, change.amount, svm)}`,
      );
    for (const approval of simulation.approvals.filter(own))
      this.lines.push(
        approval.approved === false || approval.amount === "0"
          ? `revoke ${approval.spender}'s access to ${this.named(approval)}`
          : `! allow ${approval.spender} to spend ${
              approval.unlimited
                ? `unlimited ${this.named(approval)}`
                : approval.kind === "operator"
                  ? `every ${this.named(approval)}`
                  : approval.tokenId
                    ? this.named(approval)
                    : this.amount(approval, approval.amount, svm)
            }`,
      );
    this.lines.push(
      `Simulation ${simulation.status}`,
      ...simulation.warnings.map((warning) => `! ${warning}`),
    );
  }

  /** The estimate per asset, and the most a local signature allows. */
  private fees({ type, simulation, transactions }: Execute) {
    const svm = type === "execute_svm";
    const { action } = this.view;
    const payload = action && "payload" in action ? action.payload : undefined;
    const totals = new Map<string, [Asset, bigint]>();
    for (const fee of simulation.fees)
      totals.set(fee.asset, [
        fee,
        (totals.get(fee.asset)?.[1] ?? 0n) + BigInt(fee.amount),
      ]);
    for (const [fee, total] of totals.values())
      this.lines.push(`Fee ~${this.amount(fee, String(total), svm)}`);
    if (payload?.kind === "evm_transaction") {
      const { gas_limit, max_fee_per_gas } = payload.transaction;
      this.lines.push(
        `Fee at most ${formatUnits(BigInt(gas_limit) * BigInt(max_fee_per_gas), 18)} native token`,
      );
    } else if (!svm)
      // Aomi prices its own send once approved: an estimate is no limit.
      this.lines.push(
        this.missing(
          `Fee limit not reported${simulation.gas?.units ? `, gas ~${simulation.gas.units} units` : ""}`,
        ),
      );
    // Solana reports one fee per transaction; a partial list is no total.
    else if (simulation.fees.length < transactions.length)
      this.lines.push(this.missing("Fee not reported"));
  }
}

const date = (seconds: number) => new Date(seconds * 1000).toISOString();
