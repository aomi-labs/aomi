import { createFileRoute } from "@tanstack/react-router";
import DevOperatePreview from "@/features/dev/operate-preview";

export const Route = createFileRoute("/dev/operate-preview")({
  component: () => <DevOperatePreview />,
});
