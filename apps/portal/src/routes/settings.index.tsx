import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Settings is a popup over the chat. GitHub App flows still land on
 * /settings with query params, which belong to the deployments console.
 */
export const Route = createFileRoute("/settings/")({
  beforeLoad: ({ location }) => {
    const params = new URLSearchParams(location.searchStr);
    const github =
      params.has("installation_id") ||
      params.get("launch") === "github" ||
      params.has("github_error");
    throw redirect({
      href: github ? `/deployments?${params}` : "/",
      reloadDocument: github,
    });
  },
});
