import { ControlPlaneShell } from "@/components/control-plane/control-plane-shell";

export default function ControlPlaneLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ControlPlaneShell>{children}</ControlPlaneShell>;
}
