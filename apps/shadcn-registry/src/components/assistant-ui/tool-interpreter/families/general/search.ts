import {
  asRecord,
  asString,
  hostnameFromUrl,
  normalizeHost,
} from "../../normalize";
import type { FactSource, ToolFact, ToolMatcher } from "../../types";
import { operation } from "../operation";

const MAX_SOURCE_HOSTS = 3;

const isError = (result: Record<string, unknown> | null): boolean =>
  result?.is_error === true || Boolean(result?.error);

const hostFact = (value: string, source: FactSource): ToolFact => ({
  kind: "sourceHost",
  value,
  source,
});

/** Hosts from structured `results[]`, else legacy `URL: …` text lines. */
const resultHosts = (result: Record<string, unknown>): Array<string | null> => {
  if (Array.isArray(result.results)) {
    return result.results
      .map(asRecord)
      .map((item) => normalizeHost(item?.host) ?? hostnameFromUrl(item?.url));
  }
  const text = asString(result.args) ?? asString(result.result) ?? "";
  return [...text.matchAll(/URL:\s*(https?:\/\/\S+)/gi)].map(([, url]) =>
    hostnameFromUrl(url),
  );
};

/**
 * The top result domains once the search returns any; until then (pending,
 * zero results, docs search) the query itself, so the step is never bare.
 */
export const matchWebSearch: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (isError(resultRecord)) return null;
  const hosts = resultRecord
    ? [
        ...new Set(
          resultHosts(resultRecord).filter((host): host is string => !!host),
        ),
      ].slice(0, MAX_SOURCE_HOSTS)
    : [];
  if (hosts.length > 0) {
    return operation(
      "web.search",
      rawLabel,
      hosts.map((host) => hostFact(host, "result")),
    );
  }

  const argsQuery = asString(asRecord(parsedArgs)?.query)?.trim();
  const query = argsQuery ?? asString(resultRecord?.query)?.trim();
  if (!query) return null;
  return operation("web.search", rawLabel, [
    {
      kind: "query",
      value: query.replace(/\s+/g, " "),
      source: argsQuery ? "args" : "result",
    },
  ]);
};

/** The site actually read: the post-redirect host, else the requested URL's. */
export const matchWebFetch: ToolMatcher = ({
  rawLabel,
  parsedArgs,
  resultRecord,
}) => {
  if (isError(resultRecord)) return null;
  const readHost =
    normalizeHost(resultRecord?.host) ??
    hostnameFromUrl(resultRecord?.final_url) ??
    hostnameFromUrl(resultRecord?.url);
  const host = readHost ?? hostnameFromUrl(asRecord(parsedArgs)?.url);
  return host
    ? operation("web.fetch", rawLabel, [
        hostFact(host, readHost ? "result" : "args"),
      ])
    : null;
};
