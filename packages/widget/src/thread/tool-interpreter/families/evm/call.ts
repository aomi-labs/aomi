import { EVM_SELECTOR_REGISTRY } from "@/components/assistant-ui/tool-registry";

import {
  addressFact,
  addressFromWord,
  amountFact,
  asRecord,
  asString,
  bigintFromWord,
  calldataWord,
  chainFactFromRecord,
  decodedValue,
  selectorFact,
  tokenFact,
} from "../../normalize";
import type { ToolMatcher } from "../../types";
import { formatTokenUnits, knownToken } from "../../token-registry";
import { isErrorResult, operation } from "../operation";

const calledFunction = (signature: unknown): string | undefined => {
  const raw = asString(signature)?.trim();
  if (!raw) return undefined;
  const name = /^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|$)/.exec(
    raw,
  )?.[1];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : undefined;
};

export const matchEvmCall: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (isErrorResult(resultRecord)) return null;
  const args = asRecord(parsedArgs);
  const tx = asRecord(resultRecord?.tx);
  const input = asString(tx?.input);
  const selector = selectorFact(input);
  const functionName = calledFunction(args?.function_signature);
  if (!tx && !args) return null;
  if (!selector && !functionName && !args?.to) return null;

  const selectorMeta = selector
    ? EVM_SELECTOR_REGISTRY[selector.value]
    : undefined;
  const firstAddress = input ? addressFromWord(calldataWord(input, 0)) : null;
  const secondAddress = input ? addressFromWord(calldataWord(input, 1)) : null;
  const secondAmount = input ? bigintFromWord(calldataWord(input, 1)) : null;
  const decoded = resultRecord ? decodedValue(resultRecord) : null;
  const token = knownToken(tx?.chain_id ?? args?.chain_id, tx?.to ?? args?.to);

  if (selectorMeta?.kind === "erc20_balance") {
    return operation("evm.call.erc20.balance_of", rawLabel, [
      chainFactFromRecord(tx),
      tokenFact(token?.symbol),
      addressFact(firstAddress, "owner", "decoded"),
    ]);
  }

  if (selector && selectorMeta?.kind === "erc20_metadata") {
    const isDecimals = selectorMeta.name === "decimals";
    return operation(
      isDecimals ? "evm.call.erc20.decimals" : "evm.call.erc20.metadata",
      rawLabel,
      [
        chainFactFromRecord(tx),
        tokenFact(token?.symbol),
        { ...selector, label: selectorMeta.name, role: "metadata" },
        decoded != null
          ? {
              kind: "decoded",
              role: isDecimals ? "decimals" : undefined,
              value: String(decoded),
              label: isDecimals ? `${String(decoded)} decimals` : undefined,
              source: "decoded",
            }
          : null,
      ],
    );
  }

  if (selectorMeta?.kind === "erc20_allowance") {
    return operation("evm.call.erc20.allowance", rawLabel, [
      chainFactFromRecord(tx),
      tokenFact(token?.symbol),
      addressFact(firstAddress, "owner", "decoded"),
      addressFact(secondAddress, "spender", "decoded"),
    ]);
  }

  if (selectorMeta?.kind === "erc20_approve") {
    return operation("evm.call.erc20.approve", rawLabel, [
      chainFactFromRecord(tx),
      tokenFact(token?.symbol),
      addressFact(firstAddress, "spender", "decoded"),
      amountFact(
        secondAmount && token
          ? formatTokenUnits(secondAmount, token.decimals)
          : secondAmount,
        token?.symbol ?? "raw units",
        "decoded",
      ),
    ]);
  }

  if (selectorMeta?.kind === "erc20_transfer") {
    return operation("evm.call.erc20.transfer", rawLabel, [
      chainFactFromRecord(tx),
      tokenFact(token?.symbol),
      addressFact(firstAddress, "recipient", "decoded"),
      amountFact(secondAmount, undefined, "decoded"),
    ]);
  }

  return operation(
    "evm.call.generic",
    rawLabel,
    [
      chainFactFromRecord(tx) ?? chainFactFromRecord(args, "args"),
      addressFact(tx?.from ?? args?.from, "from"),
      addressFact(tx?.to ?? args?.to, "to"),
      functionName
        ? {
            kind: "function",
            value: functionName,
            source: "args",
          }
        : null,
    ],
    { confidence: "medium" },
  );
};
