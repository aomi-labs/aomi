import { createFileRoute, notFound } from "@tanstack/react-router";
import { PoliciesFixture } from "@aomi-labs/widget/host-composition";

export const Route = createFileRoute("/dev/policies")({
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound();
  },
  component: PoliciesFixture,
});
