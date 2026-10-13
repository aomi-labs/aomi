import { createFileRoute, notFound } from "@tanstack/react-router";
import DevIndexPage from "@/features/dev/harness-index";

export const Route = createFileRoute("/dev/")({
  beforeLoad: () => {
    if (process.env.NODE_ENV === "production") throw notFound();
  },
  component: () => <DevIndexPage />,
});
