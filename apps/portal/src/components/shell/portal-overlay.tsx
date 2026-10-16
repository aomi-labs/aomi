"use client";

import {
  PackagesModal,
  SettingsModal,
  type SettingsTab,
} from "@aomi-labs/widget/host-composition";
import { OverlayPortal } from "./overlay-portal";

/** Load optional account and Library views only when the user opens them. */
export default function PortalOverlay({
  kind,
  settingsTab,
  onClose,
}: {
  kind: "settings" | "packages";
  settingsTab: SettingsTab;
  onClose: () => void;
}) {
  return (
    <OverlayPortal>
      {kind === "settings" ? (
        <SettingsModal
          key={settingsTab}
          initialTab={settingsTab}
          onClose={onClose}
        />
      ) : (
        <PackagesModal onClose={onClose} />
      )}
    </OverlayPortal>
  );
}
