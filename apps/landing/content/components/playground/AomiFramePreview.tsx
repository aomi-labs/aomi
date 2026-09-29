"use client";

import { AomiFrame } from "@aomi-labs/widget-lib";

type WalletPosition = "header" | "footer";

type AomiFramePreviewProps = {
  backendUrl: string;
  controlBarProps: {
    hideNetwork: boolean;
    hideModel: boolean;
    hideSafety: boolean;
    hideApiKey: boolean;
    hideWallet: boolean;
  };
  controlPlacement: "header" | "composer";
  embedHeight: number;
  hasAnyControl: boolean;
  showSidebar: boolean;
  walletPosition?: WalletPosition;
};

export function AomiFramePreview({
  backendUrl,
  controlBarProps,
  controlPlacement,
  embedHeight,
  hasAnyControl,
  showSidebar,
  walletPosition,
}: AomiFramePreviewProps) {
  return (
    <AomiFrame.Root
      height={`${embedHeight}px`}
      walletPosition={walletPosition ?? null}
      showSidebar={showSidebar}
      backendUrl={backendUrl}
    >
      {hasAnyControl && controlPlacement === "header" ? (
        <AomiFrame.Header
          showSidebarTrigger={showSidebar}
          withControl
          controlBarProps={controlBarProps}
        />
      ) : (
        <AomiFrame.Header showSidebarTrigger={showSidebar} />
      )}
      {hasAnyControl && controlPlacement === "composer" ? (
        <AomiFrame.Composer
          withControl
          controlBarProps={controlBarProps}
        />
      ) : (
        <AomiFrame.Composer />
      )}
    </AomiFrame.Root>
  );
}
