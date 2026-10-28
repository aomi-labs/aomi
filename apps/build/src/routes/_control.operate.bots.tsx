import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_control/operate/bots")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  beforeLoad: ({ params, search }) => {
    throw redirect({ href: "/integrations", statusCode: 307 });
  },
});
