import styles from "./defi.module.css";

const pipeline = [
  {
    step: "01",
    name: "Observe",
    body: "Collect onchain state and approved offchain evidence with provenance and timestamps.",
    tag: "evidence inventory",
  },
  {
    step: "02",
    name: "Reconcile",
    body: "Rebuild balances and exposure independently, then compare the intended position with the live one.",
    tag: "financial diff",
  },
  {
    step: "03",
    name: "Compile",
    body: "Translate the approved intent into typed, decoded, ordered state changes.",
    tag: "action packet",
  },
  {
    step: "04",
    name: "Simulate",
    body: "Resolve permissions, caps, slippage, and timelocks; execute the exact batch against current state.",
    tag: "pre-sign evidence",
  },
  {
    step: "05",
    name: "Approve",
    body: "Return the sealed packet to the operator's existing Safe, MPC, wallet, or governance process.",
    tag: "authority stays outside",
  },
  {
    step: "06",
    name: "Verify",
    body: "Correlate receipts, recompute final state, and report any remaining exposure or failed postcondition.",
    tag: "reconciled outcome",
  },
] as const;

const ownership = [
  {
    owner: "Protocol or desk",
    owns: "Mandate, risk policy, strategy models, approved runbooks, escalation rules, and operating decisions.",
  },
  {
    owner: "Aomi",
    owns: "Evidence normalization, state reconciliation, deterministic compilation, simulation, lifecycle tracking, and post-state proof.",
  },
  {
    owner: "Safe / MPC / wallet",
    owns: "Accounts, private keys, approvals, signing, and the final authority to move value or change protocol state.",
  },
] as const;

export function ExecutionArchitecture() {
  return (
    <section id="architecture" className={styles.archSection}>
      <header className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>ONE GUARDED PIPELINE</p>
          <h2>From intent to a verifiable state transition.</h2>
        </div>
        <p>
          AI may retrieve evidence and explain the packet. Financial math,
          addresses, permissions, calldata, simulation, signing, and
          postconditions remain typed, deterministic, and auditable.
        </p>
      </header>

      <ol
        className={styles.pipelineGrid}
        aria-label="Guarded execution pipeline"
      >
        {pipeline.map((item) => (
          <li key={item.name}>
            <span>{item.step}</span>
            <h3>{item.name}</h3>
            <p>{item.body}</p>
            <em>{item.tag}</em>
          </li>
        ))}
      </ol>

      <div className={styles.ownershipLedger}>
        <div className={styles.ownershipHeader}>
          <span>OWNER</span>
          <span>AUTHORITY THAT REMAINS THERE</span>
        </div>
        {ownership.map((item) => (
          <div key={item.owner} className={styles.ownershipRow}>
            <strong>{item.owner}</strong>
            <p>{item.owns}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
