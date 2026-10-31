import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/playground/")({
  beforeLoad: () => {
    throw redirect({
      to: "/playground/$",
      params: { _splat: "configurator" },
      statusCode: 307,
    });
  },
});
