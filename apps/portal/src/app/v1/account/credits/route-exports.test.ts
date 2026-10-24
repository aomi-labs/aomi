import { describe, expect, it } from "vitest";
import * as credits from "./route";
import * as ledger from "./ledger/route";
import * as methods from "./methods/route";
import * as fundingEvents from "./funding-events/route";
import * as fundingEvent from "./funding-events/[id]/route";
import * as cancelFundingEvent from "./funding-events/[id]/cancel/route";

// Next.js calls these exports directly. Exporting a whole BFF binding instead
// of one of its handlers fails only at request time, so pin the shape here.
describe("credit route modules", () => {
  it.each([
    ["credits", credits, ["GET"]],
    ["ledger", ledger, ["GET"]],
    ["methods", methods, ["GET"]],
    ["funding-events", fundingEvents, ["POST"]],
    ["funding-events/[id]", fundingEvent, ["GET"]],
    ["funding-events/[id]/cancel", cancelFundingEvent, ["POST"]],
  ] as const)("%s exports callable handlers", (_name, module, verbs) => {
    const exported = module as Record<string, unknown>;
    for (const verb of verbs) expect(typeof exported[verb]).toBe("function");
    expect(typeof exported.OPTIONS).toBe("function");
    expect(exported.runtime).toBe("nodejs");
    expect(exported.dynamic).toBe("force-dynamic");
  });
});
