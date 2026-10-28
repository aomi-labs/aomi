import { initBffSentry } from "@aomi-labs/observability";

// Page rendering only: the portal has no server routes (the edge serves them).
initBffSentry({ service: "portal-bff" });
