import "@tanstack/react-start/server-only";

import { createFailurePipeline } from "@aomi-labs/observability";

export const buildFailures = createFailurePipeline("build-bff");
