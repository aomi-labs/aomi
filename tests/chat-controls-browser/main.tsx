import { createRoot } from "react-dom/client";
import { AomiFrame } from "../../apps/shadcn-registry/src/components/aomi-frame";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <main data-testid="chat-controls-shell" className="fixture-shell">
    <p className="fixture-disclosure">
      Shared widget UI · controlled API fixture · Portal host verification
      blocked by memory limits
    </p>
    <AomiFrame.Root
      backendUrl={window.location.origin}
      height="100%"
      accountSessionAvailable
      walletPosition={null}
      products={null}
      threadPersistenceKey="issue-696-browser-fixture"
    >
      <AomiFrame.Header />
      <AomiFrame.Composer />
    </AomiFrame.Root>
  </main>,
);
