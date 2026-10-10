import { createFileRoute, redirect } from "@tanstack/react-router";
// Harness pages moved under /dev — keep the old URL working.

export const Route = createFileRoute("/mock-integration")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  beforeLoad: ({ params, search }) => {
    throw redirect({ href: "/dev/integrations-preview", statusCode: 307 });
  },
});
