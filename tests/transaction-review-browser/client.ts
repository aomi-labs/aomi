/** Minimal client exports needed by the production UI in this browser fixture. */
export const SUPPORTED_CHAINS = [{ id: 8453, name: "Base", ticker: "ETH" }];

export function normalizeSolanaCluster(cluster?: string) {
  return cluster;
}

export function summarizeSimulation(simulation: Record<string, unknown>) {
  const passed =
    simulation.status === "passed" || simulation.batch_success === true;
  return { passed, chainIds: [] as number[] };
}

export function isTerminalCommit(commit: { state?: string }) {
  return ["confirmed", "failed", "rejected", "expired"].includes(
    commit.state ?? "",
  );
}
