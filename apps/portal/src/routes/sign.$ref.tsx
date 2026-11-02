import { createFileRoute } from "@tanstack/react-router";
import { SignCommitClient } from "@/features/sign/sign-commit-client";

/** Signed out, the page opens the wallet picker, then the review. */
export const Route = createFileRoute("/sign/$ref")({
  head: () => ({ meta: [{ title: "Review transaction — Aomi" }] }),
  component: function SignPage() {
    return <SignCommitClient commitRef={Route.useParams().ref} />;
  },
});
