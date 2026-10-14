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
} from "@/thread/tool-interpreter/normalize";
import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import { knownToken } from "@/thread/tool-interpreter/token-registry";
import { isErrorResult, operation } from "@/thread/tool-interpreter/families/operation";

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
  if (!resultRecord || isErrorResult(resultRecord)) return null;

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

/** The backend returns this many holdings per chain when `limit` is null. */
const DEFAULT_LIMIT = 20;

/** Chips mirror the request: the chain when one is chosen, how many holdings
 * it fetches and, when set, what it searched for. The reply itself reports the amounts. */
export const matchErc20Holdings: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (
    resultRecord &&
    !Array.isArray(resultRecord.items) &&
    !Array.isArray(resultRecord.chains)
  )
    return null;
  const args = asRecord(parsedArgs) ?? {};
  const limit = asInteger(args.limit) ?? DEFAULT_LIMIT;
  const query = asString(args.query)?.trim();
  return operation("evm.account.erc20_holdings", rawLabel, [
    args.chain_id != null ? chainFactFromRecord(args, "args") : null,
    {
      kind: "threshold",
      value: String(limit),
      label: `Top ${limit}`,
      source: "args",
    },
    query
      ? { kind: "token", value: query, label: query, source: "args" }
      : null,
  ]);
};
