"use client";

import { useMemo } from "react";
import { AomiClient } from "@aomi-labs/client";
import {
  ConnectionMark,
  getBackendUrl,
  TelegramLinkPanel,
} from "@aomi-labs/widget/host-composition";
import { StandalonePage } from "@/components/shell/standalone-page";

/** Same-origin BFF: the Better Auth cookie is the credential. */
function createClient(): AomiClient {
  return new AomiClient({
    baseUrl: getBackendUrl(),
    guest: false,
    fetch: (input, init) =>
      fetch(input, { ...init, credentials: "same-origin", cache: "no-store" }),
  });
}

/** `/link/telegram?code=`: the wallet picker if needed, then the link sheet. */
export function LinkTelegramClient({ code }: { code: string | null }) {
  const client = useMemo(() => createClient(), []);
  return (
    <StandalonePage
      purpose={{
        icon: <ConnectionMark kind="telegram" name="Telegram" size={16} />,
        text: "To link your Telegram",
      }}
    >
      <TelegramLinkPanel
        client={client}
        code={code}
        onClose={() => window.location.assign("/")}
      />
    </StandalonePage>
  );
}
