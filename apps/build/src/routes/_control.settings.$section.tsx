import { createFileRoute, notFound } from "@tanstack/react-router";
import Screen from "@/features/settings/settings-section";

export const Route = createFileRoute("/_control/settings/$section")({
  beforeLoad: async ({ params }) => {
    // Lazy: settings-data pulls in icons, which must stay out of the route tree chunk.
    const { getSettingsSection } = await import(
      "@/features/settings/settings-data"
    );
    if (!getSettingsSection(params.section)) throw notFound();
  },
  component: SettingsSection,
});

function SettingsSection() {
  return <Screen params={Route.useParams()} />;
}
