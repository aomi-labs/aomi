import { declaredToolIdentity } from "../identity";
import {
  asRecord,
  asString,
  chainFactFromRecord,
  statusFact,
} from "../normalize";
import type { ToolMatcher } from "../types";
import { protocolOperation, validResult } from "./shared";
import type { ProtocolAdapter } from "./types";

const titles: Record<string, string> = {
  morpho_find_vaults: "Find Morpho vaults",
  morpho_vault_overview: "Read Morpho vault",
  morpho_vault_allocations: "Read Morpho vault allocations",
  morpho_vault_history: "Read Morpho vault history",
  morpho_vault_governance: "Read Morpho vault governance",
  morpho_user_vault_positions: "Read Morpho vault positions",
};

const matchMorpho: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!validResult(resultRecord) || resultRecord.source !== "morpho")
    return null;
  const title = titles[declaredToolIdentity(rawLabel)];
  if (!title) return null;
  const vault = asRecord(resultRecord.vault);
  const vaultName = asString(vault?.name);
  return protocolOperation(rawLabel, title, "read", [
    chainFactFromRecord(vault) ?? chainFactFromRecord(resultRecord),
    vaultName ? { kind: "decoded", value: vaultName, source: "result" } : null,
    statusFact(resultRecord.status),
  ]);
};

export const morpho: ProtocolAdapter = {
  tools: Object.keys(titles),
  match: matchMorpho,
};
