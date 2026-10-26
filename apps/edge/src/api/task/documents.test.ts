/**
 * Byte pins for the venue-facing Task documents. `fixtures/` was captured from
 * the backend that served these before the edge did (product-mono 510466af:
 * api-server `task/discovery.rs`, payment `task::challenge`) by running those
 * exact functions over the terms in `fixtures.ts`. `canonical-openapi.json` is
 * the API Server's /openapi.json trimmed to what the Task projection reads,
 * plus one non-Task path and component it must drop.
 */
import { describe, expect, it } from "vitest";

import agentMainnet from "./fixtures/agent.mainnet.json?raw";
import agentTestnet from "./fixtures/agent.testnet.json?raw";
import metadataMainnet from "./fixtures/build-metadata.mainnet.json?raw";
import metadataTestnet from "./fixtures/build-metadata.testnet.json?raw";
import canonicalText from "./fixtures/canonical-openapi.json?raw";
import openapiMainnet from "./fixtures/openapi.mainnet.json?raw";
import openapiTestnet from "./fixtures/openapi.testnet.json?raw";
import x402Mainnet from "./fixtures/well-known-x402.mainnet.json?raw";
import x402Testnet from "./fixtures/well-known-x402.testnet.json?raw";
import { terms } from "./test-terms";
import { agentManifest, buildMetadata, taskOpenapi, wellKnownX402 } from "./documents";
import { type Ordered, parseOrdered, stringifyOrdered } from "./json";

const cases = [
  { name: "testnet only", terms: terms(false), agent: agentTestnet, metadata: metadataTestnet, x402: x402Testnet, openapi: openapiTestnet },
  { name: "with mainnet", terms: terms(true), agent: agentMainnet, metadata: metadataMainnet, x402: x402Mainnet, openapi: openapiMainnet },
];

const canonical = () => parseOrdered(canonicalText) as Ordered;

describe("Task discovery documents match the backend byte for byte", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(stringifyOrdered(agentManifest(c.terms))).toBe(c.agent);
      expect(stringifyOrdered(buildMetadata(c.terms))).toBe(c.metadata);
      expect(stringifyOrdered(wellKnownX402(c.terms))).toBe(c.x402);
      expect(stringifyOrdered(taskOpenapi(c.terms, canonical()))).toBe(c.openapi);
    });
  }

  it("keeps the projection identical once the API Server drops its venue shims", () => {
    // After the backend cleanup the canonical contract has no GET metadata
    // operation and no probe examples; the edge supplies both.
    const plain = canonical();
    const build = plain.at("paths").at("/v1/task/build");
    build.delete("get");
    const properties = build.at("post").at("requestBody").at("content").at("application/json").at("schema").at("properties");
    for (const field of ["intent", "chainId", "sender"]) properties.at(field).delete("example");
    expect(stringifyOrdered(taskOpenapi(terms(true), plain))).toBe(openapiMainnet);
  });

  it("drops non-Task paths and components", () => {
    const projected = stringifyOrdered(taskOpenapi(terms(false), canonical()));
    expect(projected).not.toContain("/v1/agent/chat");
    expect(projected).not.toContain("NotTask");
  });

});

