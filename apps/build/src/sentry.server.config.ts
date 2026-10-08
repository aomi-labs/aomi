import { initBffSentry } from "@aomi-labs/observability";
import {
  setAccountDiagnosticObserver,
  setAccountInternalFailureObserver,
} from "@aomi-labs/account/observability";
import { buildFailures } from "@/server/bff/failures";

initBffSentry({ service: "build-bff" });
setAccountInternalFailureObserver(({ kind, error }) => {
  buildFailures.handle({
    source: "local",
    error,
    context: { routeFamily: "/api/account", operation: kind },
  });
});
setAccountDiagnosticObserver(({ kind, attributes, context, response }) => {
  buildFailures.handle({
    source: "expected",
    response,
    context,
    localDiagnostic: { kind, attributes },
  });
});
