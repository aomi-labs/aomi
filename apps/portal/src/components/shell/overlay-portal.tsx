"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOptionalSidebar } from "@aomi-labs/widget/host-composition";

/**
 * Renders full-page overlays (settings, packages) at `<body>` while keeping
 * their React tree where they are mounted.
 *
 * Both matter. The DOM escape lets one backdrop cover the sidebar and the chat
 * as a single surface, which is why these overlays used to be siblings of
 * `AomiFrame.Root`. But `AomiFrame.Root` is what mounts the Aomi runtime, so
 * a sibling sees `useOptionalAomiRuntime() === null` and cannot read the live
 * thread — that is how "Open a chat thread before enabling automatic signing."
 * came to fire with a chat open. A portal keeps the context and moves only the
 * DOM, so the overlays can live inside the frame.
 */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const sidebar = useOptionalSidebar();
  const closeMobileSidebar = sidebar?.openMobile
    ? sidebar.setOpenMobile
    : undefined;

  // The mobile sidebar is a modal sheet: while open it blocks pointer events
  // outside itself, which would include this overlay. Close it on open.
  useEffect(() => closeMobileSidebar?.(false), [closeMobileSidebar]);

  // document.body only exists after mount; SSR renders nothing.
  useEffect(() => setHost(document.body), []);

  if (!host) return null;
  return createPortal(
    // `position: fixed` makes this a stacking context, so the z-index the
    // modals set inside it counts only against each other. It needs its own
    // to clear the sidebar's `z-10`.
    <div
      className="fixed inset-0"
      data-slot="overlay-portal"
      style={{ zIndex: 60 }}
    >
      {children}
    </div>,
    host,
  );
}
