import { createFileRoute, redirect } from "@tanstack/react-router";
import { stringifyUrlSearch } from "@/lib/url-search";

export const Route = createFileRoute("/deployments/")({
  validateSearch: (search: Record<string, unknown>) =>
    search as Record<string, string | string[] | undefined>,
  beforeLoad: ({ search }) => {
    throw redirect({
      href: `/operate/deployments${stringifyUrlSearch(search)}`,
      statusCode: 307,
    });
  },
});
