import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@aomi-labs/account/better-auth";
import { signLoginRedirect } from "@/lib/sign-return";
import { SignCommitClient } from "./sign-commit-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Review transaction — Aomi",
};

/** Login-only: a guest or signed-out visitor signs in first, then returns. */
export default async function SignPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.isAnonymous === true)
    redirect(signLoginRedirect(ref));
  return <SignCommitClient commitRef={ref} />;
}
