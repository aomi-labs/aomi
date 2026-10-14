import { createFileRoute, redirect } from "@tanstack/react-router";
import { stringifyUrlSearch } from "@/lib/url-search";

export const Route = createFileRoute("/deployments/$projectId")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  beforeLoad: ({ params, search }) => {
    const { projectId } = params;
    const redirectSearch = { ...search };
    delete redirectSearch.project;
    throw redirect({
      href: `/projects/${encodeURIComponent(projectId)}${stringifyUrlSearch(redirectSearch)}`,
      statusCode: 307,
    });
  },
});
