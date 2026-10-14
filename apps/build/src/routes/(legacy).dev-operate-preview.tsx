import { createFileRoute, redirect } from "@tanstack/react-router";
// Harness pages moved under /dev — keep the old URL working.

export const Route = createFileRoute("/(legacy)/dev-operate-preview")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  beforeLoad: () => {
    throw redirect({ href: "/dev/operate-preview", statusCode: 307 });
  },
});
