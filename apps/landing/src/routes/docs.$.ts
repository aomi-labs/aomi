import { createFileRoute } from "@tanstack/react-router";
import { mintlifyRoute } from "@/lib/mintlify-route";

export const Route = createFileRoute("/docs/$")({
  server: { handlers: mintlifyRoute() },
});
