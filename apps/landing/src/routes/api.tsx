import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/api")({
  beforeLoad: () => {
    throw redirect({
      href: "/docs/build/services/api-reference",
      statusCode: 307,
    });
  },
});
