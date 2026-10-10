import "@tanstack/react-start/server-only";

import { createFailurePipeline } from "@aomi-labs/observability";

export const portalFailures = createFailurePipeline("portal-bff");
