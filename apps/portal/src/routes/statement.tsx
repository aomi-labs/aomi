import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/features/statement/statement-page";
export const Route = createFileRoute("/statement")({
  head: () => ({ meta: [{ title: "Usage statement — Aomi" }] }),
  component: Screen,
});
