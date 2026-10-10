import { createFileRoute, notFound } from "@tanstack/react-router";
import Screen from "@/screens/dev/widget-auth-e2e/page";
export const Route = createFileRoute("/dev/widget-auth-e2e")({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound();
  },
  component: Screen,
});
