import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/deployments/new")({
  beforeLoad: () => {
    throw redirect({ href: "/projects", statusCode: 307 });
  },
});
