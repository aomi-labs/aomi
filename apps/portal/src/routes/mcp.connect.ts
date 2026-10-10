import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/mcp/connect")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: `/oauth/authorize${location.searchStr}` });
  },
});
