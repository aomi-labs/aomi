"use client";

import { useEffect } from "react";

/**
 * The full-page settings surface was retired — settings now open as a popup
 * over the chat (see components/settings/settings-modal.tsx). This stub only
 * preserves external redirect targets: GitHub App flows still land on
 * /settings with query params, which belong to the deployments console.
 */
export default function SettingsRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      params.has("installation_id") ||
      params.get("launch") === "github" ||
      params.has("github_error")
    ) {
      window.location.replace(`/deployments?${params.toString()}`);
      return;
    }
    window.location.replace("/");
  }, []);

  return null;
}
