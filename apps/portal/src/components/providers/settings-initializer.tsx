"use client";

import { useSettings } from "@aomi-labs/widget/host-composition";

// Client boundary that runs `useSettings()` at the app root so persisted user
// settings (theme/colorMode) load and apply. Account display data belongs to
// the frame's runtime cache, whose principal boundary owns its lifetime.
export function SettingsInitializer({
  children,
}: {
  children: React.ReactNode;
}) {
  useSettings();

  return <>{children}</>;
}
