import { Suspense } from "react";
import { OperateView } from "@/features/operate/operate-view";

export default function OperateUsagePage() {
  return (
    <Suspense fallback={null}>
      <OperateView kind="usage" />
    </Suspense>
  );
}
