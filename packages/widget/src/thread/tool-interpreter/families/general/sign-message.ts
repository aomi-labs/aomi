import {
  asRecord,
  asString,
  chainFact,
  statusFact,
} from "@/thread/tool-interpreter/normalize";
import { toolIdentity } from "@/thread/tool-interpreter/identity";
import type { ToolMatcher } from "@/thread/tool-interpreter/types";
import {
  commitStateFact,
  commitViews,
  messageChainId,
} from "@/thread/tool-interpreter/families/general/commit-view";
import { svmClusterFact } from "@/thread/tool-interpreter/families/svm/context";
import {
  failedFact,
  operation,
} from "@/thread/tool-interpreter/families/operation";

/** evm_commit_message and svm_sign_data: one message signature per call. */
export const matchSignMessage: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  const args = asRecord(parsedArgs);
  const views = commitViews(resultRecord);
  const count = views.length || 1;
  const chainId = messageChainId(views, args);
  const cluster =
    asString(resultRecord?.cluster) ??
    asString(asRecord(resultRecord?.domain)?.cluster) ??
    asString(asRecord(args?.domain)?.cluster);
  const state =
    failedFact(resultRecord) ??
    commitStateFact(views) ??
    statusFact(resultRecord?.signature ? "signed" : resultRecord?.status);
  return operation("sign.message", rawLabel, [
    toolIdentity(rawLabel) === "svm_sign_data"
      ? cluster
        ? svmClusterFact(cluster)
        : null
      : chainFact(chainId),
    {
      kind: "count",
      value: String(count),
      label: `${count} signature${count === 1 ? "" : "s"}`,
      source: "result",
    },
    state && ["confirmed", "success", "complete"].includes(state.value)
      ? statusFact("signed")
      : state,
  ]);
};
