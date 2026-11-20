import { createFileRoute } from "@tanstack/react-router";
import { RuleChangeClient } from "@/features/rules/rule-change-client";

/**
 * A rule change by id, as Telegram links it; the page calls it a policy
 * change. Signed out, the page opens the
 * wallet picker, then the change.
 */
export const Route = createFileRoute("/rules/$changeId")({
  head: () => ({ meta: [{ title: "Review policy change — Aomi" }] }),
  component: function RuleChangePage() {
    return <RuleChangeClient changeId={Route.useParams().changeId} />;
  },
});
