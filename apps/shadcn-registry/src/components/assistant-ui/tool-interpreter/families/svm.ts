import {
  amountFact,
  asInteger,
  asRecord,
  asString,
  uniqueFacts,
} from "../normalize";
import type { ToolFact, ToolMatcher } from "../types";

const KNOWN_MAINNET_TOKEN_SYMBOLS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
};

export const svmClusterFact = (
  value: unknown,
  fallback = "mainnet-beta",
): ToolFact => {
  const cluster = asString(value) ?? fallback;
  const normalized = cluster.toLowerCase().replace(/^solana:/, "");
  const label = normalized.includes("devnet")
    ? "Solana Devnet"
    : normalized.includes("testnet")
      ? "Solana Testnet"
      : "Solana";
  return {
    kind: "cluster",
    value: cluster,
    label,
    source: "result",
  };
};

export const matchSvmContext: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  const slot = asInteger(resultRecord.current_slot);
  const cluster = asString(resultRecord.cluster);
  const supportedClusters = resultRecord.supported_clusters;
  if (!cluster || (slot == null && !Array.isArray(supportedClusters))) {
    return null;
  }

  return {
    id: "svm.context",
    facts: uniqueFacts([
      svmClusterFact(cluster),
      ...(slot == null
        ? []
        : [
            {
              kind: "slot" as const,
              value: String(slot),
              source: "result" as const,
            },
          ]),
    ]),
    confidence: "high",
    rawLabel,
  };
};

const tokenAmountFact = (
  holding: Record<string, unknown>,
  cluster: unknown,
): ToolFact | null => {
  const mint = asString(holding.mint);
  const amount =
    asString(holding.ui_amount_string) ??
    asString(holding.uiAmountString) ??
    (typeof holding.uiAmount === "number"
      ? String(holding.uiAmount)
      : undefined);
  if (!amount) return null;

  const clusterName = asString(cluster)?.toLowerCase();
  const isMainnet =
    clusterName === "mainnet-beta" ||
    clusterName === "mainnet" ||
    clusterName === "solana:mainnet";
  const symbol =
    asString(holding.symbol) ??
    (mint && isMainnet ? KNOWN_MAINNET_TOKEN_SYMBOLS[mint] : undefined);
  const fact = amountFact(amount, symbol);
  return fact ? { ...fact, role: "primary" } : null;
};

const rawTokenHolding = (value: unknown): Record<string, unknown> | null => {
  const keyedAccount = asRecord(value);
  const account = asRecord(keyedAccount?.account);
  const data = asRecord(account?.data);
  const parsed = asRecord(data?.parsed);
  const info = asRecord(parsed?.info);
  const tokenAmount = asRecord(info?.tokenAmount);
  if (!info || !tokenAmount) return null;
  return {
    mint: info.mint,
    uiAmount: tokenAmount.uiAmount,
    uiAmountString: tokenAmount.uiAmountString,
  };
};

const accountsFrom = (value: unknown): unknown[] => {
  const record = asRecord(value);
  return Array.isArray(record?.accounts) ? record.accounts : [];
};

export const matchSvmTokenHoldings: ToolMatcher = ({
  rawLabel,
  resultRecord,
}) => {
  if (!resultRecord || !asString(resultRecord.owner)) return null;

  const compactHoldings = Array.isArray(resultRecord.holdings)
    ? resultRecord.holdings
        .map(asRecord)
        .filter(
          (holding): holding is Record<string, unknown> => holding != null,
        )
    : [];
  const rawAccounts = [
    ...(Array.isArray(resultRecord.accounts) ? resultRecord.accounts : []),
    ...accountsFrom(resultRecord.token_program),
    ...accountsFrom(resultRecord.token_2022_program),
  ];
  if (compactHoldings.length === 0 && rawAccounts.length === 0) return null;

  const holdings =
    compactHoldings.length > 0
      ? compactHoldings
      : rawAccounts
          .map(rawTokenHolding)
          .filter(
            (holding): holding is Record<string, unknown> => holding != null,
          );
  const amounts = holdings
    .map((holding) => tokenAmountFact(holding, resultRecord.cluster))
    .filter((fact): fact is ToolFact => fact != null);

  return {
    id: "svm.account.token_holdings",
    facts: uniqueFacts([svmClusterFact(resultRecord.cluster), ...amounts]),
    confidence: "high",
    rawLabel,
  };
};
