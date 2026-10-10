import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/dev/operate-preview/page";

export const Route = createFileRoute("/dev/operate-preview")({
  component: () => <Screen />,
});
