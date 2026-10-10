import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/dev/page";

export const Route = createFileRoute("/dev/")({
  component: () => <Screen />,
});
