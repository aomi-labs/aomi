import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_control/")({
  beforeLoad: () => {
    throw redirect({ href: "/packages", statusCode: 307 });
  },
});
