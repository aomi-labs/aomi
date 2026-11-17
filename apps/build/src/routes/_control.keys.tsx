import { createFileRoute } from "@tanstack/react-router";

import { KeysView } from "@/features/keys/keys-view";

export const Route = createFileRoute("/_control/keys")({
  component: KeysView,
});
