import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/examples/")({
  beforeLoad: () => {
    throw redirect({
      to: "/examples/$",
      params: { _splat: "polymarket" },
      statusCode: 307,
    });
  },
});
