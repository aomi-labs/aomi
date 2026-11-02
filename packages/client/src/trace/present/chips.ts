import { shortAddress } from "../../short-address";

import { SHAPE_ICONS, STAGED_ACTION_ICON_REGISTRY } from "../registry";

import { humanize } from "../normalize";
import type { ToolChip, ToolFact } from "../types";

const formatInteger = (value: string): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : value;
};

const shortenAddress = (address: string): string =>
  /^0x[a-fA-F0-9]{40}$/.test(address) ? shortAddress(address) : address;

const formatNativeAmount = (value: string): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  if (numeric === 0) return "0";

  const formatted = numeric.toLocaleString("en-US", {
    maximumFractionDigits: 5,
    useGrouping: false,
  });

  return formatted === "0" ? "<0.00001" : formatted;
};

const statusChip = (value: string): ToolChip => {
  switch (value) {
    case "queued":
    case "staged":
      return { label: "Staged", icon: "success" };
    case "pending":
      return { label: "Pending confirmation", icon: "pending" };
    case "pending_approval":
      return { label: "Awaiting approval", icon: "pending" };
    case "attestation_ready":
      return { label: "Attestation ready", icon: "pending" };
    case "needs_signature":
      return { label: "Awaiting signature", icon: "pending" };
    case "awaiting_broadcast":
      return { label: "Awaiting broadcast", icon: "pending" };
    case "submitted":
      return { label: "Submitted", icon: "pending" };
    case "passed":
      return { label: "Passed", icon: "success" };
    case "confirmed":
      return { label: "Confirmed", icon: "success" };
    case "prepared":
      return { label: "Prepared", icon: "success" };
    case "incomplete":
      return { label: "Incomplete", icon: "pending" };
    case "partial":
      return { label: "Partial", icon: "warning" };
    case "refunded":
      return { label: "Refunded", icon: "incoming" };
    case "unknown":
      return { label: "Status unknown", icon: "warning" };
    case "success":
      return { label: "Success", icon: "success" };
    case "signed":
      return { label: "Signed", icon: "success" };
    case "failed":
    case "error":
      return { label: "Failed", icon: "failed" };
    case "revoked":
      return { label: "Revoked", icon: "blocked" };
    case "rejected":
      return { label: "Rejected", icon: "blocked" };
    case "expired":
      return { label: "Expired", icon: "blocked" };
    default:
      return { label: humanize(value) };
  }
};

const stagedActionIcon = (value: string) => {
  const lower = value.toLowerCase().replace(/[_-]+/g, " ");
  for (const [pattern, icon] of STAGED_ACTION_ICON_REGISTRY) {
    if (pattern.test(lower)) return icon;
  }
  return SHAPE_ICONS.staged;
};

export const chipForFact = (fact: ToolFact): ToolChip | null => {
  switch (fact.kind) {
    case "action":
      return {
        label: fact.label ?? humanize(fact.value),
        icon: stagedActionIcon(fact.value),
      };
    case "address":
      if (fact.role === "owner") {
        return { label: shortenAddress(fact.value), icon: "user" };
      }
      if (fact.role === "from") {
        return { label: shortenAddress(fact.value), icon: "outgoing" };
      }
      if (
        fact.role === "recipient" ||
        fact.role === "spender" ||
        fact.role === "to"
      ) {
        return { label: shortenAddress(fact.value), icon: "incoming" };
      }
      return { label: shortenAddress(fact.value) };
    case "amount":
      if (fact.role === "native") {
        return {
          label: `${formatNativeAmount(fact.value)}${fact.label ? ` ${fact.label}` : ""}`,
          icon: "coins",
        };
      }
      if (fact.role === "primary" || fact.role === "secondary") {
        return { label: fact.label ?? fact.value, icon: "coins" };
      }
      return { label: fact.label ?? fact.value, icon: "coins" };
    case "block":
      return { label: formatInteger(fact.value), icon: "block" };
    case "category":
      return { label: fact.label ?? humanize(fact.value), icon: "tag" };
    case "chain": {
      const chainId = Number(fact.value);
      return {
        label: fact.label ?? fact.value,
        // Renderers fall back to a generic network icon for chains without a
        // mark (BSC, Solana, ...).
        icon: Number.isFinite(chainId) ? `chain:${chainId}` : "network",
      };
    }
    case "cluster":
      return { label: fact.label ?? humanize(fact.value), icon: "solana" };
    case "code":
      return { label: fact.label ?? fact.value };
    case "contract":
      return { label: shortenAddress(fact.value), icon: "contract" };
    case "compute":
      return {
        label: `${formatInteger(fact.value)} compute units`,
        icon: "gas",
      };
    case "count":
      if (fact.role === "results") {
        return { label: fact.label ?? fact.value, icon: "list" };
      }
      if (fact.label) return { label: fact.label, icon: "receipt" };
      if (fact.role === "tx") {
        const count = Number(fact.value);
        return {
          label: `${fact.value} tx${count === 1 ? "" : "s"}`,
          icon: "receipt",
        };
      }
      if (fact.role === "instruction") {
        const count = Number(fact.value);
        return {
          label: `${fact.value} instruction${count === 1 ? "" : "s"}`,
          icon: "receipt",
        };
      }
      if (fact.role === "staged") {
        return { label: `staged ${fact.value}`, icon: SHAPE_ICONS.staged };
      }
      return { label: fact.value };
    case "decoded":
      if (fact.role === "decimals") {
        return {
          label: fact.label ?? `${fact.value} decimals`,
          icon: "hash",
        };
      }
      return { label: fact.label ?? fact.value };
    case "gas":
      return { label: `${formatInteger(fact.value)} gas`, icon: "gas" };
    case "function":
      return { label: fact.label ?? fact.value, icon: "code" };
    case "protocol":
      return { label: fact.label ?? fact.value, icon: "protocol" };
    case "requirement":
      return { label: fact.label ?? fact.value, icon: "pending" };
    case "route":
      return { label: fact.label ?? fact.value, icon: "swap" };
    case "selector":
      return { label: fact.label ?? fact.value };
    case "skill":
      // Renderers with a skill catalog replace this by `skillId`.
      return {
        id: `skill:${fact.value}`,
        skillId: fact.value,
        label: humanize(fact.value.split("/").at(-1) ?? fact.value),
        icon: `skill:${fact.value}`,
      };
    case "query":
      return {
        label:
          fact.value.length > 32
            ? `${fact.value.slice(0, 31).trimEnd()}…`
            : fact.value,
        title: fact.value,
        icon: "search",
      };
    case "sourceHost":
      return { label: fact.label ?? fact.value, icon: "globe" };
    case "status":
      return statusChip(fact.value);
    case "threshold":
      return { label: fact.label ?? fact.value, icon: "ranked" };
    case "slot":
      return {
        label: fact.label ?? formatInteger(fact.value),
        icon: "block",
      };
    case "token":
      return {
        label: fact.label ?? shortenAddress(fact.value),
        icon: "coins",
      };
    case "txId":
      return {
        label: shortAddress(fact.value, { head: 7, tail: 5 }),
        icon: "receipt",
      };
    case "warning":
      return { label: fact.label ?? fact.value, icon: "warning" };
    case "yield":
      return { label: fact.label ?? fact.value, icon: "percent" };
    default:
      return null;
  }
};

export const uniqueChips = (chips: ToolChip[]): ToolChip[] => {
  const seen = new Set<string>();
  return chips.filter((chip) => {
    const key = chip.id ?? chip.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
