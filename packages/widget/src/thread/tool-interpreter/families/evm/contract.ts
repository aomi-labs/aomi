import {
  asRecord,
  asString,
  chainFactFromRecord,
  normalizeAddress,
} from "@/thread/tool-interpreter/normalize";
import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import { isErrorResult, operation } from "@/thread/tool-interpreter/families/operation";

const meaningful = (value: unknown): string | undefined =>
  asString(value)?.trim() || undefined;

const contractIdentity = (
  contract: Record<string, unknown> | undefined,
  args: Record<string, unknown> | null,
) => {
  const field = (name: string) =>
    meaningful(contract?.[name]) ?? meaningful(args?.[name]);
  const type = field("contract_type");
  const address = normalizeAddress(field("address"));
  // Token standards describe a broad shape; a protocol or symbol identifies
  // the particular contract more clearly in the trace.
  if (type && !/^ERC[- ]?\d+$/i.test(type)) return type;
  return (
    field("protocol") ??
    field("symbol") ??
    field("name") ??
    type ??
    (address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : address)
  );
};

export const matchTokenLookup: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (isErrorResult(resultRecord)) return null;
  const args = asRecord(parsedArgs);
  if (!resultRecord && !args) return null;

  const contracts = Array.isArray(resultRecord?.contracts)
    ? resultRecord.contracts
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => !!item)
    : [];
  const first = contracts[0];
  const found = resultRecord?.found === true;
  const identity = contractIdentity(found ? first : undefined, args);

  return operation(
    `evm.contract.lookup.${found ? "found" : "missing"}`,
    rawLabel,
    [
      chainFactFromRecord(first) ??
        chainFactFromRecord(resultRecord) ??
        chainFactFromRecord(args, "args"),
      identity
        ? {
            kind: "contract",
            value: identity,
            source: found && first ? "result" : "args",
          }
        : null,
    ],
  );
};
