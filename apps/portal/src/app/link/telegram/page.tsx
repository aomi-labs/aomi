import type { Metadata } from "next";
import { isTelegramLinkCode } from "@aomi-labs/client";
import { LinkTelegramClient } from "./link-telegram-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Link Telegram — Aomi",
  // The code is in the URL; never send it on to another site.
  referrer: "no-referrer",
};

/**
 * Signed out, the page opens the wallet picker, then the link review. A
 * malformed code renders as invalid without asking the backend.
 */
export default async function LinkTelegramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await searchParams;
  return <LinkTelegramClient code={isTelegramLinkCode(code) ? code : null} />;
}
