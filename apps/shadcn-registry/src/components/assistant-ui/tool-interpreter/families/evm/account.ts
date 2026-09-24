import {
  addressFact,
  amountFact,
  asRecord,
  asString,
  chainFactFromRecord,
} from "../../normalize";
import type { ToolMatcher } from "../../types";
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
