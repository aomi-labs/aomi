"use client";

import { AomiFrame } from "@aomi-labs/widget/frame";
import { Preview } from "@/content/components/playground/preview";

const widgetCode = `import { AomiFrame } from "@aomi-labs/widget/frame";

export function WidgetDemo() {
  return (
    <AomiFrame.Root height="560px" width="100%" walletPosition="footer">
      <AomiFrame.Header withControl controlBarProps={{ hideNetwork: false }} />
      <AomiFrame.Composer />
    </AomiFrame.Root>
  );
}`;

export function WidgetFrame() {
  const backendUrl = "/";

  return (
    <AomiFrame.Root
      height="560px"
      width="100%"
      walletPosition="footer"
      backendUrl={backendUrl}
    >
      <AomiFrame.Header withControl controlBarProps={{ hideNetwork: false }} />
      <AomiFrame.Composer />
    </AomiFrame.Root>
  );
}

export function WidgetDemo() {
  return (
    <Preview
      title="AomiFrame live demo"
      description="Chat surface, thread list, and composer running with wallet integration in sidebar footer."
      code={widgetCode}
      badge="Live"
    >
      <WidgetFrame />
    </Preview>
  );
}
