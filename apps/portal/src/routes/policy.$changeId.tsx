import { createFileRoute } from "@tanstack/react-router";
import { PolicyChangeClient } from "@/features/policy/policy-change-client";

/**
 * A policy change by id. Signed out, the page opens the wallet picker, then
 * the change.
 */
export const Route = createFileRoute("/policy/$changeId")({
  head: () => ({ meta: [{ title: "Review policy change — Aomi" }] }),
  component: function PolicyChangePage() {
    return <PolicyChangeClient changeId={Route.useParams().changeId} />;
  },
});
