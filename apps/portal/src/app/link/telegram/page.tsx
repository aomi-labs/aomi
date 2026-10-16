import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isTelegramLinkCode } from "@aomi-labs/client";
import { auth } from "@aomi-labs/account/better-auth";
import { loginRedirect, telegramLinkPath } from "@/lib/sign-return";
import { LinkTelegramClient } from "./link-telegram-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Link Telegram — Aomi",
  // The code is in the URL; never send it on to another site.
  referrer: "no-referrer",
};

/**
 * Login-only: a guest or signed-out visitor signs in first, then returns. A
 * malformed code renders as invalid without asking the backend.
 */
export default async function LinkTelegramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await searchParams;
  if (!isTelegramLinkCode(code)) return <LinkTelegramClient code={null} />;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.isAnonymous === true)
    redirect(loginRedirect(telegramLinkPath(code)));
  return <LinkTelegramClient code={code} />;
}
