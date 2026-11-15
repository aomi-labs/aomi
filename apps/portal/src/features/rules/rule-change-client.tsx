import { useMemo } from "react";
import { RuleChangePanel } from "@aomi-labs/widget/host-composition";
import { createPortalAomi } from "@/lib/portal-client";
import { StandalonePage } from "@/components/shell/standalone-page";

/** `/rules/:changeId`: the wallet picker if needed, then the rule change. */
export function RuleChangeClient({ changeId }: { changeId: string }) {
  const client = useMemo(() => createPortalAomi(), []);
  return (
    <StandalonePage purpose={{ text: "To review a rule change" }}>
      <RuleChangePanel
        client={client}
        changeId={changeId}
        onClose={() => window.location.assign("/")}
      />
    </StandalonePage>
  );
}
