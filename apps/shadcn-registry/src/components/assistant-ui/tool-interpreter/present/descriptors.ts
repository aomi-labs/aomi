import type { LucideIcon } from "lucide-react";

import {
  EVM_SELECTOR_REGISTRY,
  SHAPE_ICONS,
  STAGED_ACTION_ICON_REGISTRY,
} from "@/components/assistant-ui/tool-registry";

import type { FactKind, FactRole, ToolOperation } from "../types";
import { fallbackIcon } from "./fallback";

export type ChipSlot = {
  kind: FactKind;
  role?: FactRole;
  repeat?: boolean;
};

export type Descriptor = {
  title: "fixed" | "label";
  fixedTitle?: string;
  icon: LucideIcon | "fallback" | "stagedAction";
  chipPlan: ChipSlot[];
};

const stagedActionIcon = (operation: ToolOperation): LucideIcon => {
  const action = operation.facts.find((fact) => fact.kind === "action");
  const lower = (action?.value ?? action?.label ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  for (const [pattern, icon] of STAGED_ACTION_ICON_REGISTRY) {
    if (pattern.test(lower)) return icon;
  }
  return SHAPE_ICONS.staged;
};

const descriptorById: Record<string, Descriptor> = {
  "evm.account.native_balance": {
    title: "label",
    icon: SHAPE_ICONS.nativeBalance,
    chipPlan: [
      { kind: "chain" },
      { kind: "address", role: "owner" },
      { kind: "amount" },
    ],
  },
  "evm.call.erc20.allowance": {
    title: "fixed",
    fixedTitle: EVM_SELECTOR_REGISTRY["0xdd62ed3e"].title,
    icon: EVM_SELECTOR_REGISTRY["0xdd62ed3e"].icon,
    chipPlan: [
      { kind: "chain" },
      { kind: "token" },
      { kind: "address", role: "owner" },
      { kind: "address", role: "spender" },
    ],
  },
  "evm.call.erc20.approve": {
    title: "fixed",
    fixedTitle: EVM_SELECTOR_REGISTRY["0x095ea7b3"].title,
    icon: EVM_SELECTOR_REGISTRY["0x095ea7b3"].icon,
    chipPlan: [
      { kind: "chain" },
      { kind: "token" },
      { kind: "address", role: "spender" },
      { kind: "amount" },
    ],
  },
  "evm.call.erc20.balance_of": {
    title: "fixed",
    fixedTitle: EVM_SELECTOR_REGISTRY["0x70a08231"].title,
    icon: EVM_SELECTOR_REGISTRY["0x70a08231"].icon,
    chipPlan: [
      { kind: "chain" },
      { kind: "token" },
      { kind: "address", role: "owner" },
    ],
  },
  "evm.call.erc20.decimals": {
    title: "fixed",
    fixedTitle: EVM_SELECTOR_REGISTRY["0x313ce567"].title,
    icon: EVM_SELECTOR_REGISTRY["0x313ce567"].icon,
    chipPlan: [
      { kind: "chain" },
      { kind: "token" },
      { kind: "decoded", role: "decimals" },
    ],
  },
  "evm.call.erc20.metadata": {
    title: "fixed",
    fixedTitle: "Read token metadata",
    icon: SHAPE_ICONS.tokenLookup,
    chipPlan: [
      { kind: "chain" },
      { kind: "token" },
      { kind: "selector", role: "metadata" },
      { kind: "decoded" },
    ],
  },
  "evm.call.erc20.transfer": {
    title: "fixed",
    fixedTitle: EVM_SELECTOR_REGISTRY["0xa9059cbb"].title,
    icon: EVM_SELECTOR_REGISTRY["0xa9059cbb"].icon,
    chipPlan: [
      { kind: "chain" },
      { kind: "token" },
      { kind: "address", role: "recipient" },
      { kind: "amount" },
    ],
  },
  "evm.call.generic": {
    title: "label",
    icon: "fallback",
    chipPlan: [
      { kind: "chain" },
      { kind: "address", role: "from" },
      { kind: "address", role: "to" },
    ],
  },
  "evm.context": {
    title: "fixed",
    fixedTitle: "Check network",
    icon: SHAPE_ICONS.chainContext,
    chipPlan: [{ kind: "chain" }, { kind: "block" }],
  },
  "evm.contract.lookup.found": {
    title: "fixed",
    fixedTitle: "Resolve contract",
    icon: SHAPE_ICONS.tokenLookup,
    chipPlan: [{ kind: "chain" }, { kind: "token" }],
  },
  "evm.contract.lookup.missing": {
    title: "fixed",
    fixedTitle: "Resolve token",
    icon: SHAPE_ICONS.tokenLookup,
    chipPlan: [{ kind: "chain" }, { kind: "token" }],
  },
  "evm.tx.simulate_batch": {
    title: "fixed",
    fixedTitle: "Simulate batch",
    icon: SHAPE_ICONS.simulation,
    chipPlan: [
      { kind: "chain" },
      { kind: "count", role: "tx" },
      { kind: "gas" },
      { kind: "status" },
    ],
  },
  "evm.tx.pending_approval": {
    title: "fixed",
    fixedTitle: "Commit transactions",
    icon: SHAPE_ICONS.commit,
    chipPlan: [
      { kind: "chain" },
      { kind: "count", role: "tx" },
      { kind: "txId" },
      { kind: "status" },
    ],
  },
  "lifi.approval": {
    title: "label",
    icon: EVM_SELECTOR_REGISTRY["0x095ea7b3"].icon,
    chipPlan: [
      { kind: "chain" },
      { kind: "token" },
      { kind: "amount", role: "primary" },
    ],
  },
  "lifi.quote": {
    title: "label",
    icon: SHAPE_ICONS.swap,
    chipPlan: [
      { kind: "chain" },
      { kind: "amount", role: "primary" },
      { kind: "amount", role: "secondary" },
      { kind: "token", role: "primary" },
    ],
  },
  "lifi.swap.prepare": {
    title: "label",
    icon: SHAPE_ICONS.swap,
    chipPlan: [
      { kind: "chain" },
      { kind: "sourceHost" },
      { kind: "amount", role: "primary" },
      { kind: "amount", role: "secondary" },
      { kind: "token", role: "primary" },
    ],
  },
  "jupiter.swap.prepare": {
    title: "label",
    icon: SHAPE_ICONS.swap,
    chipPlan: [
      { kind: "cluster" },
      { kind: "amount", role: "primary" },
      { kind: "amount", role: "secondary" },
      { kind: "token", role: "primary" },
    ],
  },
  "skill.activate": {
    title: "fixed",
    fixedTitle: "Activate skill",
    icon: SHAPE_ICONS.skillActivation,
    chipPlan: [{ kind: "skill", repeat: true }],
  },
  "task.delegate": {
    // Title comes from the operation (it carries the child's label).
    title: "label",
    icon: SHAPE_ICONS.delegation,
    chipPlan: [
      { kind: "code" },
      { kind: "count", role: "staged" },
      { kind: "status" },
    ],
  },
  "svm.context": {
    title: "fixed",
    fixedTitle: "Check network",
    icon: SHAPE_ICONS.chainContext,
    chipPlan: [{ kind: "cluster" }, { kind: "slot" }],
  },
  "svm.account.token_holdings": {
    title: "label",
    icon: SHAPE_ICONS.nativeBalance,
    chipPlan: [{ kind: "amount", role: "primary", repeat: true }],
  },
  "svm.tx.pending_approval": {
    title: "fixed",
    fixedTitle: "Commit transactions",
    icon: SHAPE_ICONS.commit,
    chipPlan: [
      { kind: "cluster" },
      { kind: "count", role: "tx" },
      { kind: "txId" },
      { kind: "status" },
    ],
  },
  "svm.tx.simulate_batch": {
    title: "fixed",
    fixedTitle: "Simulate batch",
    icon: SHAPE_ICONS.simulation,
    chipPlan: [{ kind: "count", role: "tx" }, { kind: "status" }],
  },
  "tool.error": {
    title: "label",
    icon: "fallback",
    chipPlan: [{ kind: "status" }],
  },
  "web.search": {
    title: "fixed",
    fixedTitle: "Search web",
    icon: SHAPE_ICONS.search,
    chipPlan: [
      { kind: "token" },
      { kind: "count", role: "results" },
      { kind: "sourceHost" },
    ],
  },
};

const stagedDescriptor: Descriptor = {
  title: "label",
  icon: "stagedAction",
  chipPlan: [
    { kind: "chain" },
    { kind: "action" },
    { kind: "count", role: "tx" },
    { kind: "status" },
  ],
};

const fallbackDescriptor: Descriptor = {
  title: "label",
  icon: "fallback",
  chipPlan: [{ kind: "token" }, { kind: "chain" }, { kind: "status" }],
};

export const descriptorFor = (operation: ToolOperation): Descriptor => {
  if (operation.id.startsWith("evm.tx.stage.")) return stagedDescriptor;
  return descriptorById[operation.id] ?? fallbackDescriptor;
};

export const iconForDescriptor = (
  descriptor: Descriptor,
  operation: ToolOperation,
): LucideIcon => {
  if (descriptor.icon === "fallback") return fallbackIcon(operation.rawLabel);
  if (descriptor.icon === "stagedAction") return stagedActionIcon(operation);
  return descriptor.icon;
};
