import { classifyFailure } from "./classify";
import type { AppService, FailurePipeline } from "./failure";
import { identifyFailure } from "./identify";
import { routeFailure } from "./route";

export function createFailurePipeline(service: AppService): FailurePipeline {
  return Object.freeze({
    handle(input) {
      try {
        return routeFailure(classifyFailure(identifyFailure(input)), service);
      } catch (error) {
        return routeFailure(
          {
            action: "issue",
            reason: "local_exception",
            error,
            context: {
              routeFamily: "/observability",
              operation: "observability.pipeline_failure",
            },
            handled: true,
            responseStatus: 500,
            responseError: "internal_error",
          },
          service,
        );
      }
    },
  });
}
