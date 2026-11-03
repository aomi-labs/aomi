import {
  amountFact,
  asInteger,
  asRecord,
  asString,
  statusFact,
  uniqueFacts,
} from "../../normalize";
import { isErrorResult, operation } from "../operation";
import type { ToolFact, ToolMatcher } from "../../types";

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

/** Owner programs whose accounts a reader recognizes by kind. */
const ACCOUNT_KINDS: Record<string, string> = {
  "11111111111111111111111111111111": "Wallet",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "Token account",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token account",
  BPFLoaderUpgradeab1e11111111111111111111111: "Program",
};

const LAMPORTS_PER_SOL = 1_000_000_000;

export const matchSvmProgram: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (!resultRecord || isErrorResult(resultRecord)) return null;
  const args = asRecord(parsedArgs);
  const program = Array.isArray(resultRecord.programs)
    ? asRecord(resultRecord.programs[0])
    : undefined;
  const identity =
    asString(program?.name) ??
    asString(program?.program_id) ??
    asString(args?.name) ??
    asString(args?.program_id);
  const instruction = asString(args?.instruction);
  return operation("svm.program.lookup", rawLabel, [
    program?.cluster ? svmClusterFact(program.cluster) : null,
    identity ? { kind: "contract", value: identity, source: "result" } : null,
    instruction
      ? { kind: "function", value: instruction, source: "args" }
      : null,
    resultRecord.found === false ? statusFact("not found") : null,
  ]);
};

export const matchSvmAccountInfo: ToolMatcher = ({
  rawLabel,
  resultRecord,
}) => {
  const pubkey = asString(resultRecord?.pubkey);
  if (!resultRecord || !pubkey) return null;
  const owner = asString(resultRecord.owner_program_id);
  const kind =
    resultRecord.executable === true
      ? "Program"
      : owner
        ? ACCOUNT_KINDS[owner]
        : undefined;
  const lamports = asInteger(resultRecord.lamports);
  const sol = lamports == null ? null : amountFact(lamports / LAMPORTS_PER_SOL);
  return operation("svm.account.info", rawLabel, [
    svmClusterFact(resultRecord.cluster),
    { kind: "address", role: "owner", value: pubkey, source: "result" },
    kind
      ? { kind: "category", value: kind, label: kind, source: "result" }
      : null,
    sol ? { ...sol, role: "native", label: "SOL" } : null,
    resultRecord.found === false ? statusFact("not found") : null,
  ]);
};

export const matchSvmDeriveAddress: ToolMatcher = ({
  rawLabel,
  resultRecord,
}) => {
  const address = asString(resultRecord?.address);
  if (!resultRecord || !address) return null;
  const tokenAccount = resultRecord.kind === "associated_token_account";
  const mint = asString(resultRecord.mint);
  const symbol = mint ? KNOWN_MAINNET_TOKEN_SYMBOLS[mint] : undefined;
  return operation("svm.address.derive", rawLabel, [
    {
      kind: "category",
      value: tokenAccount ? "Token account" : "Program address",
      label: tokenAccount ? "Token account" : "Program address",
      source: "result",
    },
    { kind: "address", role: "to", value: address, source: "result" },
    tokenAccount && mint
      ? { kind: "token", value: mint, label: symbol, source: "result" }
      : null,
  ]);
};
