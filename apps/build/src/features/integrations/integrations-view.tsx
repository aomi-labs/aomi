import { ChannelsView } from "@/features/operate/channels-view";
import { PageHeader, pageFrame } from "@/components/control-plane/page";

export function IntegrationsView() {
  return (
    <div className={pageFrame}>
      <PageHeader
        title="Channels"
        summary={
          <p>
            Connect the channels where your users already work. Each channel is
            configured once and serves one Aomi agent.
          </p>
        }
      />
      <ChannelsView />
    </div>
  );
}
