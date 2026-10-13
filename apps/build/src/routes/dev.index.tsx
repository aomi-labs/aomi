import { createFileRoute, notFound } from "@tanstack/react-router";
import Screen from "@/screens/dev/page";

export const Route = createFileRoute("/dev/")({
  beforeLoad: () => {
    if (process.env.NODE_ENV === "production") throw notFound();
  },
  component: () => <Screen />,
});
