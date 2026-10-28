/** Shared inputs for the Task byte pins; provenance is in the tests that use them. */
import type { TaskTerms } from "./terms";

export const terms = (allow_mainnet: boolean): TaskTerms => ({
  resource_url: "https://api-staging.aomi.dev/v1/task/build",
  pay_to: "0x2222222222222222222222222222222222222222",
  asset: "0x3600000000000000000000000000000000000000",
  allow_mainnet,
});
