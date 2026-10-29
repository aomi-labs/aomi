import type { Metadata } from "next";
import { SignCommitClient } from "./sign-commit-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review transaction — Aomi",
};

/** Signed out, the page opens the wallet picker, then the review. */
export default async function SignPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  return <SignCommitClient commitRef={ref} />;
}
