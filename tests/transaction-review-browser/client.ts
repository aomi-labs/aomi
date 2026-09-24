/** Minimal client exports needed by the production UI in this browser fixture. */
export const SUPPORTED_CHAINS = [
  { id: 8453, name: "Base", ticker: "ETH" },
  { id: 5042, name: "Arc", ticker: "USDC" },
];

export function isOfficialAppDescriptor(app: {
  applicationId?: number | null;
  platform?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const source = app.metadata?.source;
  const registeredVia = app.metadata?.registered_via;
  return (
    source === "builtin" ||
    registeredVia === "official_source" ||
    (app.applicationId == null && !app.platform && registeredVia == null)
  );
}

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
