import { createFileRoute } from "@tanstack/react-router";
import { HomeRedirect } from "@/features/overview/home-redirect";

export const Route = createFileRoute("/_control/")({
  component: HomePage,
});

function HomePage() {
  return <HomeRedirect />;
}
