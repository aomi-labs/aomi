import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/_marketing/news")({
  beforeLoad: () => {
    throw redirect({ to: "/blog", statusCode: 308 });
  },
});
