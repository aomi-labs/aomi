/**
 * Byte pins for the venue-facing Task documents. `fixtures/` was captured from
 * the backend that served these before the edge did (product-mono 510466af:
 * api-server `task/discovery.rs`, payment `task::challenge`) by running those
 * exact functions over the terms in `fixtures.ts`. `canonical-openapi.json` is
 * the API Server's /openapi.json trimmed to what the Task projection reads,
 * plus one non-Task path and component it must drop.
 */
import { describe, expect, it } from "vitest";

import preparationMainnet from "./fixtures/challenge.preparation.mainnet.b64?raw";
import preparationTestnet from "./fixtures/challenge.preparation.testnet.b64?raw";
import retrievalTestnet from "./fixtures/challenge.retrieval.testnet.b64?raw";
import { listOnBazaar, withBazaar } from "./bazaar";
import { sortedJson } from "./json";

/** The challenge as Payment issues it once it no longer lists itself on Bazaar. */
function unlisted(header: string): string {
  const challenge = JSON.parse(atob(header)) as { extensions: Record<string, unknown> };
  delete challenge.extensions.bazaar;
  return btoa(sortedJson(challenge));
}

describe("Bazaar listing", () => {
  for (const [name, fixture] of [["testnet", preparationTestnet], ["mainnet", preparationMainnet]] as const) {
    it(`adds Payment's exact listing to a ${name} preparation challenge`, () => {
      expect(withBazaar(unlisted(fixture))).toBe(fixture);
    });

    it(`is idempotent on a ${name} challenge Payment already listed`, () => {
      expect(withBazaar(fixture)).toBe(fixture);
    });
  }

  it("never lists a result challenge", () => {
    expect(withBazaar(retrievalTestnet)).toBe(retrievalTestnet);
  });

  it("passes anything that is not a challenge through", () => {
    expect(withBazaar("not base64 json")).toBe("not base64 json");
  });

  it("decorates the 402 header and the body's copy, keeping the body's key order", async () => {
    const header = unlisted(preparationTestnet);
    const body = `{"status":"payment_required","stage":"preparation","amountMicrousd":"10000","refundPolicy":"paid_attempt","paymentRequired":"${header}"}`;
    const response = await listOnBazaar(
      new Response(body, { status: 402, headers: { "Payment-Required": header, "Content-Type": "application/json", "Cache-Control": "no-store" } }),
    );
    expect(response.status).toBe(402);
    expect(response.headers.get("payment-required")).toBe(preparationTestnet);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(body.replace(header, preparationTestnet));
  });

  it("leaves other responses alone", async () => {
    const accepted = new Response("{}", { status: 202 });
    expect(await listOnBazaar(accepted)).toBe(accepted);
  });
});

