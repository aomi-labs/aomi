import { asString, hostnameFromUrl } from "../../normalize";
import type { ToolMatcher } from "../../types";
import { operation } from "../operation";

export const matchWebSearch: ToolMatcher = ({ rawLabel, resultRecord }) => {
  if (!resultRecord) return null;
  const body = asString(resultRecord.args) ?? asString(resultRecord.result);
  if (!body || !/Found\s+\d+\s+results/i.test(body)) return null;

  const count = body.match(/Found\s+(\d+)\s+results/i)?.[1];
  const firstUrl = body.match(/URL:\s*(https?:\/\/\S+)/i)?.[1];
  const source = firstUrl ? hostnameFromUrl(firstUrl) : null;

  return operation("web.search", rawLabel, [
    count
      ? { kind: "count", role: "results", value: count, source: "result" }
      : null,
    source ? { kind: "sourceHost", value: source, source: "result" } : null,
  ]);
};
