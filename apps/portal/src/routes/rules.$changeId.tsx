import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The page's old address, which Telegram and the backend's `approve_url`
 * still link to.
 */
export const Route = createFileRoute("/rules/$changeId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/policy/$changeId",
      params: { changeId: params.changeId },
    });
  },
});
