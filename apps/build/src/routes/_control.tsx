import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ControlPlaneShell } from "@/components/control-plane/control-plane-shell";

export const Route = createFileRoute("/_control")({
  component: () => (
    <ControlPlaneShell>
      <Outlet />
    </ControlPlaneShell>
  ),
});
