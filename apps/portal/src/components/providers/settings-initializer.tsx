import { useEffect } from "react";
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

  // The phone's status bar and the home-screen app's chrome take the page's
  // theme colour. Keep it on the theme the app shows, not the system's.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      const color = root.classList.contains("dark") ? "#09090b" : "#ffffff";
      document
        .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
        .forEach((meta) => {
          meta.removeAttribute("media");
          meta.content = color;
        });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return <>{children}</>;
}
