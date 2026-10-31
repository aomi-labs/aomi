import { initAppSentry } from "@aomi-labs/observability";

// Page rendering only: the portal has no server routes (the edge serves them).
initAppSentry({ service: "portal" });
