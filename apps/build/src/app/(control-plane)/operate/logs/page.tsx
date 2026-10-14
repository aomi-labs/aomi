import { Suspense } from "react";
import { OperateView } from "@/features/operate/operate-view";

export default function OperateLogsPage() {
  return (
    <Suspense fallback={null}>
      <OperateView kind="logs" />
    </Suspense>
  );
}
