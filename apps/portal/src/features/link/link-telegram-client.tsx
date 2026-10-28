import { useMemo } from "react";
import {
  ConnectionMark,
  TelegramLinkPanel,
} from "@aomi-labs/widget/host-composition";
import { createPortalClient } from "@/lib/portal-client";
import { StandalonePage } from "@/components/shell/standalone-page";

/** `/link/telegram?code=`: the wallet picker if needed, then the link sheet. */
export function LinkTelegramClient({ code }: { code: string | null }) {
  const client = useMemo(() => createPortalClient(), []);
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
