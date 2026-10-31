import { createFileRoute } from "@tanstack/react-router";
import CliAuthCompletePage from "@/features/cli/auth-complete";

export const Route = createFileRoute("/cli/auth-complete")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  component: CliAuthComplete,
  head: () => ({ meta: [{ title: "CLI authorization · Aomi Build" }] }),
});

function CliAuthComplete() {
  return <CliAuthCompletePage searchParams={Route.useSearch()} />;
}
