import { EVM_SELECTOR_REGISTRY } from "@/components/assistant-ui/tool-registry";

import {
  addressFact,
  addressFromWord,
  amountFact,
  asString,
  bigintFromWord,
  calldataWord,
  chainFactFromRecord,
  decodedValue,
  selectorFact,
  topicTokenFact,
  uniqueFacts,
} from "../normalize";
import type { ToolFact, ToolMatcher, ToolOperation } from "../types";

const op = (
  id: string,
  rawLabel: string,
  facts: Array<ToolFact | null>,
  confidence: ToolOperation["confidence"] = "high",
): ToolOperation => ({
  id,
  facts: uniqueFacts(facts.filter((fact): fact is ToolFact => fact != null)),
  confidence,
  rawLabel,
});

export const matchEvmCall: ToolMatcher = ({ rawLabel, resultRecord }) => {
  const tx =
    resultRecord && typeof resultRecord.tx === "object"
      ? (resultRecord.tx as Record<string, unknown>)
      : null;
  const input = asString(tx?.input);
  if (!resultRecord || !tx || !input) return null;
  const selector = selectorFact(input);
  if (!selector) return null;

  const selectorMeta = EVM_SELECTOR_REGISTRY[selector.value];
  const firstAddress = addressFromWord(calldataWord(input, 0));
  const secondAddress = addressFromWord(calldataWord(input, 1));
  const secondAmount = bigintFromWord(calldataWord(input, 1));
  const decoded = decodedValue(resultRecord);

  if (selectorMeta?.kind === "erc20_balance") {
    return op("evm.call.erc20.balance_of", rawLabel, [
      chainFactFromRecord(tx),
      topicTokenFact(rawLabel),
      addressFact(firstAddress, "owner", "decoded"),
    ]);
  }

  if (selectorMeta?.kind === "erc20_metadata") {
    const isDecimals = selectorMeta.name === "decimals";
    return op(
      isDecimals ? "evm.call.erc20.decimals" : "evm.call.erc20.metadata",
      rawLabel,
      [
        chainFactFromRecord(tx),
        topicTokenFact(rawLabel),
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
    return op("evm.call.erc20.allowance", rawLabel, [
      chainFactFromRecord(tx),
      topicTokenFact(rawLabel),
      addressFact(firstAddress, "owner", "decoded"),
      addressFact(secondAddress, "spender", "decoded"),
    ]);
  }

  if (selectorMeta?.kind === "erc20_approve") {
    return op("evm.call.erc20.approve", rawLabel, [
      chainFactFromRecord(tx),
      topicTokenFact(rawLabel),
      addressFact(firstAddress, "spender", "decoded"),
      amountFact(secondAmount, undefined, "decoded"),
    ]);
  }

  if (selectorMeta?.kind === "erc20_transfer") {
    return op("evm.call.erc20.transfer", rawLabel, [
      chainFactFromRecord(tx),
      topicTokenFact(rawLabel),
      addressFact(firstAddress, "recipient", "decoded"),
      amountFact(secondAmount, undefined, "decoded"),
    ]);
  }

  return op(
    "evm.call.generic",
    rawLabel,
    [
      chainFactFromRecord(tx),
      addressFact(tx.from, "from"),
      addressFact(tx.to, "to"),
    ],
    "medium",
  );
};
