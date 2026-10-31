import { createFileRoute } from "@tanstack/react-router";
import { StatementView } from "@aomi-labs/widget/host-composition";

export const Route = createFileRoute("/statement")({
  head: () => ({ meta: [{ title: "Usage statement — Aomi" }] }),
  component: StatementView,
});
