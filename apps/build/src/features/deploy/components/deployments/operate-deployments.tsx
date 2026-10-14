"use client";

import { GlobalDeploymentsList } from "./global-deployments-list";

export function OperateDeployments({ platform }: { platform: string }) {
  return <GlobalDeploymentsList platform={platform} />;
}
