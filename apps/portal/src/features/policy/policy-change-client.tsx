import { useMemo } from "react";
import { PolicyChangePanel } from "@aomi-labs/widget/host-composition";
import { createPortalAomi } from "@/lib/portal-client";
import { StandalonePage } from "@/components/shell/standalone-page";

/** `/policy/:changeId`: the wallet picker if needed, then the policy change. */
export function PolicyChangeClient({ changeId }: { changeId: string }) {
  const client = useMemo(() => createPortalAomi(), []);
  return (
    <StandalonePage purpose={{ text: "To review a policy change" }}>
      <PolicyChangePanel
        client={client}
        changeId={changeId}
        onClose={() => window.location.assign("/")}
      />
    </StandalonePage>
  );
}
