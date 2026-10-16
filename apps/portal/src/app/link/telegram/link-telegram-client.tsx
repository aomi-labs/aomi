"use client";

import { useMemo } from "react";
import { AomiClient } from "@aomi-labs/client";
import {
  TelegramLinkPanel,
  getBackendUrl,
} from "@aomi-labs/widget/host-composition";

/** Same-origin BFF: the Better Auth cookie is the credential. */
function createClient(): AomiClient {
  return new AomiClient({
    baseUrl: getBackendUrl(),
    guest: false,
    fetch: (input, init) =>
      fetch(input, { ...init, credentials: "same-origin", cache: "no-store" }),
  });
}

/** A centered host for the widget's Telegram link review. */
export function LinkTelegramClient({ code }: { code: string | null }) {
  const client = useMemo(createClient, []);
  return (
    <main
      data-testid="link-telegram-page"
      className="bg-aomi-bg text-aomi-fg flex h-full w-full justify-center overflow-y-auto px-4 py-10 sm:items-center"
    >
      <div className="w-full max-w-md">
        <TelegramLinkPanel client={client} code={code} />
        <a
          href="/"
          className="type-meta text-aomi-muted hover:text-aomi-fg mt-6 inline-block"
        >
          Back to Aomi
        </a>
      </div>
    </main>
  );
}
