import { Plug } from "lucide-react";
import { ChannelsView } from "@/features/operate/channels-view";
import { pageFrame, pageTitle } from "@/components/control-plane/page";

export function IntegrationsView() {
  return (
    <div className={pageFrame}>
      <div className="space-y-3">
        <p className="text-dim text-[12px] uppercase tracking-wide">Account</p>
        <div className="flex items-center gap-2">
          <Plug className="text-dim size-5" aria-hidden />
          <h1 className={pageTitle}>Integrations</h1>
        </div>
        <p className="text-subtle max-w-2xl text-sm">
          Connect the channels where your users already work. Each channel is
          configured once and serves one Aomi agent.
        </p>
      </div>

      <ChannelsView />
    </div>
  );
}
