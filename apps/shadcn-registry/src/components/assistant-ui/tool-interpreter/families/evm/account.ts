import {
  addressFact,
  amountFact,
  asInteger,
  asRecord,
  asString,
  chainFactFromRecord,
  normalizeAddress,
  statusFact,
  tokenFact,
} from "../../normalize";
import type { ToolMatcher } from "../../types";
import { knownToken } from "../../token-registry";
import { operation } from "../operation";

export const matchNativeBalance: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (!resultRecord) return null;
  const address = addressFact(resultRecord.address, "owner");
  const native = amountFact(resultRecord.balance_native);
  const eth = amountFact(resultRecord.balance_eth);
  const balance = native ?? eth;
  if (!address || !balance) return null;

  const reportedCurrency = asString(resultRecord.native_currency);
  const currency =
    native && reportedCurrency && /^[A-Za-z0-9]{2,12}$/.test(reportedCurrency)
      ? reportedCurrency
      : eth && !native
        ? "ETH"
        : undefined;

  return operation("evm.account.native_balance", rawLabel, [
    chainFactFromRecord(resultRecord) ??
      chainFactFromRecord(asRecord(parsedArgs), "args"),
    address,
    { ...balance, role: "native", label: currency },
  ]);
};

export const matchErc20Balance: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord || resultRecord.is_error === true || resultRecord.error)
    return null;

  const tokenAddress = normalizeAddress(resultRecord.token);
  const reportedBalance = amountFact(resultRecord.balance);
  if (
    !tokenAddress ||
    !reportedBalance ||
    !/^\d+(?:\.\d+)?$/.test(reportedBalance.value)
  )
    return null;

  const symbol = knownToken(resultRecord.chain_id, tokenAddress)?.symbol;
  return operation("evm.account.erc20_balance", rawLabel, [
    chainFactFromRecord(resultRecord),
    tokenFact(symbol ?? tokenAddress),
    addressFact(resultRecord.holder, "owner"),
    amountFact(reportedBalance.value, symbol),
  ]);
};

export const matchErc20Holdings: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord || !Array.isArray(resultRecord.items)) return null;
  if (typeof resultRecord.complete !== "boolean") return null;

  const holder = addressFact(resultRecord.holder, "owner");
  const total = asInteger(resultRecord.total_matching);
  const shown = resultRecord.items.length;
  if (!holder || total == null || total < shown) return null;

  const warningCount = Array.isArray(resultRecord.warnings)
    ? resultRecord.warnings.length
    : 0;
  const countLabel =
    shown === total
      ? `${total.toLocaleString("en-US")} holding${total === 1 ? "" : "s"}`
      : `${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} holdings`;

  return operation("evm.account.erc20_holdings", rawLabel, [
    chainFactFromRecord(resultRecord),
    {
      kind: "count",
      role: "results",
      value: String(shown),
      label: countLabel,
      source: "result",
    },
    holder,
    resultRecord.complete === false
      ? statusFact("incomplete")
      : warningCount > 0
        ? {
            kind: "warning",
            value: String(warningCount),
            label: `${warningCount} warning${warningCount === 1 ? "" : "s"}`,
            source: "result",
          }
        : null,
  ]);
};
