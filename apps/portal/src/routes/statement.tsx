import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/statement/page";
export const Route = createFileRoute("/statement")({
  head: () => ({ meta: [{ title: "Usage statement — Aomi" }] }),
  component: Screen,
});
