import {
  asInteger,
  asRecord,
  asString,
  statusFact,
} from "@/thread/tool-interpreter/normalize";
import type { ToolFact } from "@/thread/tool-interpreter/types";

export const commitViews = (
  result: Record<string, unknown> | null,
): Record<string, unknown>[] =>
  Array.isArray(result?.commits)
    ? result.commits
        .map(asRecord)
        .filter((view): view is Record<string, unknown> => view != null)
    : [];

/**
 * The one chain every view shares. The wire sends it bare (`8453`, or the SVM
 * cluster name); a legacy `evm:`/`svm:` prefix is tolerated.
 */
export const commitChainRef = (
  views: Record<string, unknown>[],
  family: "evm" | "svm",
): string | undefined => {
  const first = views[0];
  return views.every(
    (view) =>
      view.chain_family === family && view.chain_ref === first?.chain_ref,
  )
    ? asString(first?.chain_ref)?.replace(/^(evm|svm):/, "")
    : undefined;
};

export const commitStateFact = (
  views: Record<string, unknown>[],
): ToolFact | null => {
  if (views.length === 0) return null;
  const states = views.map((view) => asString(view.state));
  for (const state of ["failed", "rejected", "expired"]) {
    if (states.includes(state)) return statusFact(state);
  }
  if (states.every((state) => state === "confirmed"))
    return statusFact("confirmed");
  for (const state of [
    "awaiting_approval",
    "needs_signature",
    "awaiting_broadcast",
    "submitted",
  ]) {
    if (states.includes(state)) return statusFact(state);
  }
  return null;
};

export const commitCountFact = (
  views: Record<string, unknown>[],
): ToolFact | null => {
  if (views.length === 0) return null;
  const confirmed = views.filter((view) => view.state === "confirmed").length;
  return {
    kind: "count",
    role: "tx",
    value: String(views.length),
    label:
      confirmed > 0 && confirmed < views.length
        ? `${confirmed}/${views.length} confirmed`
        : undefined,
    source: "result",
  };
};

/**
 * The network a message signature is for, only when the message itself names
 * it: an EIP-712 `domain.chainId`. A commit's own chain id is the wallet's
 * active chain for a plain-text message, so it never counts.
 */
export const messageChainId = (
  views: Record<string, unknown>[],
  args?: Record<string, unknown> | null,
): number | undefined => {
  const typedData = [
    ...views.flatMap((view) => {
      const payloads = asRecord(asRecord(view.review)?.request)?.payloads;
      return Array.isArray(payloads)
        ? payloads.map((payload) => asRecord(payload)?.typed_data)
        : [];
    }),
    args?.typed_data,
  ];
  for (const value of typedData) {
    let typed = value;
    if (typeof typed === "string") {
      try {
        typed = JSON.parse(typed);
      } catch {
        continue;
      }
    }
    const chainId = asInteger(asRecord(asRecord(typed)?.domain)?.chainId);
    if (chainId) return chainId;
  }
  return undefined;
};
