import { initBffSentry } from "@aomi-labs/observability";
import {
  setAccountDiagnosticObserver,
  setAccountInternalFailureObserver,
  setBetterAuthFailureObserver,
} from "@aomi-labs/account/observability";
import { portalFailures } from "@/server/bff/failures";

initBffSentry({ service: "portal-bff" });
setAccountInternalFailureObserver(({ kind, error }) => {
  portalFailures.handle({
    source: "local",
    error,
    context: { routeFamily: "/api/account", operation: kind },
  });
});
setAccountDiagnosticObserver(({ kind, attributes, context, response }) => {
  portalFailures.handle({
    source: "expected",
    response,
    context,
    localDiagnostic: { kind, attributes },
  });
});
setBetterAuthFailureObserver(({ error, status }) => {
  if (status !== undefined && status < 500) return;
  portalFailures.handle({
    source: "local",
    error,
    context: {
      routeFamily: "/api/auth/[...all]",
      operation: "better_auth",
    },
  });
});
