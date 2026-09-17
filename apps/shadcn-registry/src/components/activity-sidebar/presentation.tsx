import type { FC, SVGProps } from "react";
import type { ActionRequest } from "@aomi-labs/client";
import { normalizeSolanaCluster } from "@aomi-labs/client";
import { getChainInfo } from "@aomi-labs/react";
import { FileSignature, Layers3 } from "lucide-react";
import { STAGED_ACTION_ICON_REGISTRY } from "../assistant-ui/tool-registry";

export type Simulation = Extract<
  ActionRequest,
  { type: "execute_evm" | "execute_svm" }
>["simulation"];
export type BalanceChange = Simulation["balanceChanges"][number];
export type ApprovalChange = Simulation["approvals"][number];
export type TransactionIcon = FC<SVGProps<SVGSVGElement>>;
export type SupportedChain = {
  id: number;
  name: string;
  nativeCurrency?: { symbol?: string };
  rpcUrls?: { default: { http: readonly string[] } };
};

const STALE_FAILED_SIMULATION_WARNING = "simulation did not pass";

export type TransactionView = {
  label: string;
  network: string;
  chainId?: number;
  destination?: string;
  protocol?: string;
  kind: "approval" | "action";
  Icon: TransactionIcon;
};

export function actionTransactions(
  request: ActionRequest,
  supportedChains?: readonly SupportedChain[],
): TransactionView[] {
  if (request.type === "execute_evm") {
    return request.transactions.map((transaction, index) => {
      const chain = supportedChains?.find(
        (candidate) => candidate.id === transaction.chain_id,
      );
      const label = friendlyTransactionLabel(
        transaction.label || `Transaction ${index + 1}`,
        transaction.kind,
      );
      const semantic = transactionSemantic(label, transaction.kind);
      return {
        label,
        network:
          chain?.name ??
          getChainInfo(transaction.chain_id)?.name ??
          `Chain ${transaction.chain_id}`,
        chainId: transaction.chain_id,
        destination: transaction.to,
        protocol: transaction.protocol,
        ...semantic,
      };
    });
  }
  if (request.type === "execute_svm") {
    return request.transactions.map((transaction, index) => {
      const label = transaction.description || `Transaction ${index + 1}`;
      return {
        label,
        network:
          normalizeSolanaCluster(transaction.cluster) ??
          transaction.cluster ??
          "Solana",
        ...transactionSemantic(label),
      };
    });
  }
  const chainId = request.chainId;
  const chain = chainId
    ? supportedChains?.find((candidate) => candidate.id === chainId)
    : undefined;
  return [
    {
      label: request.description || "Sign wallet request",
      network:
        request.chainFamily === "svm"
          ? (normalizeSolanaCluster(request.cluster) ??
            request.cluster ??
            "Solana")
          : (chain?.name ?? (chainId ? `Chain ${chainId}` : "Ethereum")),
      destination: request.signer,
      kind: "action",
      Icon: FileSignature,
    },
  ];
}

export function transactionSemantic(
  label: string,
  kind?: string,
): Pick<TransactionView, "kind" | "Icon"> {
  const text = `${kind ?? ""} ${label}`.toLowerCase().replaceAll("_", " ");
  const Icon =
    STAGED_ACTION_ICON_REGISTRY.find(([pattern]) => pattern.test(text))?.[1] ??
    Layers3;
  return {
    kind: /approv|allowance|permit/.test(text) ? "approval" : "action",
    Icon,
  };
}

export function pageRangeLabel(
  startIndex: number,
  visible: number,
  total: number,
): string {
  const start = startIndex + 1;
  const end = start + visible - 1;
  return `${start}${end > start ? `–${end}` : ""} of ${total}`;
}

export function simulationCostSummary(
  simulation: Simulation | undefined,
): string {
  if (!simulation) return "No network fee";
  if (simulation.fees.length) {
    return `~${formatFeeSummary(simulation.fees)} fee`;
  }
  if (simulation.gas?.units) {
    return `Estimated gas · ${formatInteger(simulation.gas.units)} units`;
  }
  return simulation.status === "failed"
    ? "No gas will be spent"
    : "Gas estimate unavailable";
}

export function friendlyTransactionLabel(label: string, kind?: string): string {
  let clean = label.trim();
  const normalizedKind = kind?.toLowerCase() ?? "";

  clean = clean
    .replace(/\s+using\s+quote\s+\S+\s*$/i, "")
    .replace(/\s+on\s+chain\s+\d+\s*$/i, "")
    .replace(/^approve\s+li\.fi\s+swap\s+spender\s+for\s+exact\s+/i, "Approve ")
    .replace(/^li\.fi\s+same-chain\s+swap\s+quote\s+\S+\s*:\s*/i, "Swap ")
    .replace(/^li\.fi\s+same-chain\s+swap\s+/i, "Swap ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalizedKind.includes("approve") && !/^approve\b/i.test(clean)) {
    return `Approve ${clean}`;
  }
  if (normalizedKind.includes("swap") && !/^swap\b/i.test(clean)) {
    return `Swap ${clean}`;
  }
  return clean;
}

export function assetChangePresentation(
  change: BalanceChange,
  symbol: string,
  decimals?: number,
): { verb: string; value: string; detail?: string } {
  const incoming = change.direction === "in";
  const outgoing = change.direction === "out";
  const zeroCounterparty = isZeroAddress(change.counterparty);
  const collection = change.name ?? symbol;

  if (change.standard === "erc721") {
    return {
      verb: zeroCounterparty
        ? incoming
          ? "NFT minted"
          : outgoing
            ? "NFT burned"
            : "NFT change"
        : incoming
          ? "NFT received"
          : outgoing
            ? "NFT sent"
            : "NFT change",
      value: `${collection}${change.tokenId ? ` #${change.tokenId}` : ""}`,
      detail: zeroCounterparty
        ? incoming
          ? "New to your wallet"
          : "Removed from circulation"
        : change.counterparty
          ? `${incoming ? "From" : "To"} ${compact(change.counterparty)}`
          : "ERC-721",
    };
  }

  if (change.standard === "erc1155") {
    return {
      verb: zeroCounterparty
        ? incoming
          ? "Collectible minted"
          : outgoing
            ? "Collectible burned"
            : "Collectible change"
        : incoming
          ? "Collectible received"
          : outgoing
            ? "Collectible sent"
            : "Collectible change",
      value: `${incoming ? "+" : outgoing ? "−" : ""}${formatAssetAmount(change.amount, 0)} × ${collection}${change.tokenId ? ` #${change.tokenId}` : ""}`,
      detail: zeroCounterparty
        ? incoming
          ? "New to your wallet"
          : "Removed from circulation"
        : change.counterparty
          ? `${incoming ? "From" : "To"} ${compact(change.counterparty)}`
          : "ERC-1155",
    };
  }

  return {
    verb: incoming ? "You receive" : outgoing ? "You send" : "Wallet change",
    value: `${incoming ? "+" : outgoing ? "−" : ""}${formatAssetAmount(change.amount, decimals)} ${symbol}`,
  };
}

export function approvalTitle(
  approval: ApprovalChange,
  symbol: string,
): string {
  const revoked = isRevokedApproval(approval);
  if (approval.kind === "allowance") {
    if (revoked) return `Revoke ${symbol} spending`;
    if (approval.unlimited) return `Unlimited ${symbol} spending`;
    return `Allow ${formatAssetAmount(approval.amount ?? "0", approval.decimals ?? undefined)} ${symbol}`;
  }

  const token = approval.tokenId ? `${symbol} #${approval.tokenId}` : symbol;
  if (approval.kind === "token") {
    return revoked ? `Revoke ${token} approval` : `Approve ${token}`;
  }
  return revoked
    ? `Revoke access to all ${symbol}`
    : `Allow access to all ${symbol}`;
}

export function approvalScope(approval: ApprovalChange): string {
  if (isRevokedApproval(approval)) {
    if (approval.kind === "operator") return "Collection access removed";
    if (approval.kind === "token") return "NFT access removed";
    return "Spending access removed";
  }
  if (approval.kind === "operator") return "Entire collection";
  if (approval.kind === "token") return "One NFT";
  if (approval.unlimited) return "No spending limit";
  return "Spending limit";
}

export function isRevokedApproval(approval: ApprovalChange): boolean {
  return (
    approval.approved === false ||
    approval.amount === "0" ||
    (approval.kind === "token" && isZeroAddress(approval.spender))
  );
}

export function isZeroAddress(value: string | null | undefined): boolean {
  return Boolean(value && /^0x0{40}$/i.test(value));
}

export function balanceChangeNetwork(
  change: BalanceChange,
  request: ActionRequest,
  supportedChains?: readonly SupportedChain[],
): string | undefined {
  if (change.cluster) {
    return normalizeSolanaCluster(change.cluster) ?? change.cluster;
  }
  const chainId = change.chainId ?? firstEvmChainId(request);
  if (!chainId) return undefined;
  return (
    supportedChains?.find((chain) => chain.id === chainId)?.name ??
    `Chain ${chainId}`
  );
}

export function visibleSimulationWarnings(
  simulation: Simulation | undefined,
): string[] {
  if (!simulation) return [];
  if (simulation.status !== "passed") return simulation.warnings;
  return simulation.warnings.filter(
    (warning) =>
      warning.trim().toLowerCase() !== STALE_FAILED_SIMULATION_WARNING,
  );
}

export function formatFeeSummary(fees: Simulation["fees"]): string {
  const first = fees[0];
  if (!first) return "Unavailable";
  const decimals =
    first.decimals ?? (first.asset === "native" ? 18 : undefined);
  const symbol =
    first.symbol ??
    (first.asset === "native" ? "native" : assetFallback(first.asset));
  const suffix = fees.length > 1 ? ` + ${fees.length - 1} more` : "";
  return `${formatAssetAmount(first.amount, decimals)} ${symbol}${suffix}`;
}

export function formatAssetAmount(amount: string, decimals?: number): string {
  const normalized = amount.trim();
  if (!normalized) return "0";
  if (normalized.includes(".") || decimals === undefined) return normalized;
  try {
    const negative = normalized.startsWith("-");
    const digits = (negative ? normalized.slice(1) : normalized).replace(
      /^0+(?=\d)/,
      "",
    );
    if (!/^\d+$/.test(digits)) return normalized;
    if (decimals === 0) return `${negative ? "-" : ""}${digits}`;
    const padded = digits.padStart(decimals + 1, "0");
    const whole = padded.slice(0, -decimals);
    const fraction = padded.slice(-decimals).replace(/0+$/, "");
    const value = fraction ? `${whole}.${fraction}` : whole;
    return `${negative ? "-" : ""}${value}`;
  } catch {
    return normalized;
  }
}

export function formatInteger(value: string): string {
  try {
    return new Intl.NumberFormat("en-US").format(BigInt(value));
  } catch {
    return value;
  }
}

export function assetFallback(asset: string): string {
  if (!asset || asset === "native") return "Asset";
  return asset.startsWith("0x") ? compact(asset) : asset;
}

export function firstEvmChainId(request: ActionRequest): number | undefined {
  if (request.type === "execute_evm") return request.transactions[0]?.chain_id;
  return request.type === "sign" ? request.chainId : undefined;
}

export function compact(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
