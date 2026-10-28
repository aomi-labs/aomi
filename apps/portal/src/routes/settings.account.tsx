import { createFileRoute, redirect } from "@tanstack/react-router";

/** Settings is a popup over the chat; this link opens it on Account. */
export const Route = createFileRoute("/settings/account")({
  beforeLoad: () => {
    throw redirect({ href: "/?settings=account" });
  },
});
