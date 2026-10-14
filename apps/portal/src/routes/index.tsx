import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/screens/page";
export const Route = createFileRoute("/")({
  component: Screen,
});
