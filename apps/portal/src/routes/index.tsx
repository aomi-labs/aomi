import { createFileRoute } from "@tanstack/react-router";
import Screen from "@/features/home/home-page";
export const Route = createFileRoute("/")({
  component: Screen,
});
