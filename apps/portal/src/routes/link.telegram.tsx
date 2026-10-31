import { createFileRoute } from "@tanstack/react-router";
import { isLinkCode } from "@aomi-labs/client";
import { LinkTelegramClient } from "@/features/link/link-telegram-client";

/**
 * Signed out, the page opens the wallet picker, then the link review. A
 * malformed code renders as invalid without asking the backend.
 */
export const Route = createFileRoute("/link/telegram")({
  validateSearch: (search: Record<string, unknown>) => ({
    code: isLinkCode(search.code) ? search.code : null,
  }),
  head: () => ({
    meta: [
      { title: "Link Telegram — Aomi" },
      // The code is in the URL; never send it on to another site.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: function LinkTelegramPage() {
    return <LinkTelegramClient code={Route.useSearch().code} />;
  },
});
