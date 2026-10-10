import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { OperateView } from "@/features/operate/operate-view";

export const Route = createFileRoute("/_control/operate/logs")({
  component: OperateLogsPage,
});

function OperateLogsPage() {
  return (
    <Suspense fallback={null}>
      <OperateView kind="logs" />
    </Suspense>
  );
}
