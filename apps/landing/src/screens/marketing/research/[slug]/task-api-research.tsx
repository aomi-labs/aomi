import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "../../longform.module.css";

const richBlockPattern = /(::task-api-(?:alice|quickstart)::)/;

const taskSteps = [
  "The Task API reconstructs the request and verifies Alice’s wallet.",
  "The calls are simulated against pinned Arc state.",
  "Changed targets, excess spend, insufficient output or failed calls are rejected.",
  "The agent receives a signed 402 preview and checks whether the rehearsed edge still clears its threshold.",
  "Payment and execution require separate wallet signatures.",
];

const outcomeRows = [
  ["Order-book proceeds", "990.000 USDC"],
  ["Maximum Arc repurchase", "−940.500 USDC"],
  ["Gross trading edge", "49.500 USDC"],
  ["Task price: $1 + 3%", "−29.215 USDC"],
];

const launchCapabilities = [
  "Signature-only Task authorization",
  "Arc Mainnet simulation",
  "Signed 402 quote and artifact hash",
  "Separate USDC service payment",
  "Bounded native-USDC execution",
];

const frontierCapabilities = [
  "Pool-aware swap preparation",
  "Approval and multicall validation",
  "Minimum-received verification",
  "Live route and receipt proof",
  "Independently verifiable simulation",
];

const quickstartSteps = [
  [
    "Define one bounded task",
    "State the intent, allowed targets, value limits, slippage and expiry.",
  ],
  [
    "Authorize the exact request",
    "The buyer’s wallet signs the EIP-712 Task authorization.",
  ],
  [
    "Inspect the rehearsed outcome",
    "Review the calls, state changes, constraints, price and artifact hash returned with the 402.",
  ],
  [
    "Pay, then execute",
    "Approve the service payment and sign the exact transaction as separate wallet actions.",
  ],
];

function AliceExample() {
  return (
    <>
      <section className={styles.taskExample}>
        <header className={styles.taskExampleHeader}>
          <p>Illustrative future swap integration</p>
          <h3>
            “Buy at least 900 EURC. Spend at most 940.50 USDC. Refuse if the
            route changes.”
          </h3>
        </header>
        <div className={styles.taskExampleGrid}>
          <div className={styles.taskExampleCopy}>
            <h4>What the signed task binds</h4>
            <p>
              Chain, wallet, exact pool and approval targets, maximum outgoing
              USDC, minimum EURC received, gas ceiling, call order, idempotency
              key and a five-minute expiry.
            </p>
            <ol className={styles.taskSteps}>
              {taskSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div className={styles.taskExampleMath}>
            <h4>Known before purchase</h4>
            <table>
              <tbody>
                {outcomeRows.map(([label, amount]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{amount}</td>
                  </tr>
                ))}
                <tr className={styles.taskTotal}>
                  <td>Edge before gas</td>
                  <td>20.285 USDC</td>
                </tr>
              </tbody>
            </table>
            <p className={styles.taskFinePrint}>
              Illustrative prices, not a claim about an available spread. The
              point is that simulation-verified execution and its price enter
              the agent’s decision before it commits.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.taskReality}>
        <div className={styles.taskLive}>
          <h3>Available at launch</h3>
          <ul>
            {launchCapabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </div>
        <div className={styles.taskLater}>
          <h3>Next protocol frontier</h3>
          <ul>
            {frontierCapabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

function TaskCode() {
  return (
    <pre className={styles.taskCode}>
      <code>
        <span className={styles.taskCodeKeyword}>import</span>
        {` { ArcExecutionKit } `}
        <span className={styles.taskCodeKeyword}>from</span>
        {"\n  "}
        <span className={styles.taskCodeString}>
          &quot;arc-canteen/task-client&quot;
        </span>
        {`;\n\n`}
        <span className={styles.taskCodeKeyword}>const</span>
        {` kit = ArcExecutionKit.arcMainnet({\n  endpoint:\n    `}
        <span className={styles.taskCodeString}>
          &quot;https://api.aomi.dev/v1/task/build&quot;
        </span>
        {`,\n  wallet,\n  rpcUrl,\n  recipient: trustedTaskSeller,\n  trustedJwks,\n});\n\n`}
        <span className={styles.taskCodeKeyword}>const</span>
        {` quote = `}
        <span className={styles.taskCodeKeyword}>await</span>
        {` kit.prepare({\n  intent: `}
        <span className={styles.taskCodeString}>
          &quot;Send 0.01 USDC&quot;
        </span>
        {`,\n  reference: `}
        <span className={styles.taskCodeString}>&quot;invoice-1042&quot;</span>
        {`,\n  sender: wallet.walletAddress,\n  recipient: approvedRecipient,\n  amountUsdc: `}
        <span className={styles.taskCodeString}>&quot;0.01&quot;</span>
        {`,\n}, reviewTaskAuthorization);`}
      </code>
    </pre>
  );
}

function TaskLinks({ quickstart = false }: { quickstart?: boolean }) {
  return (
    <div className={styles.taskActions}>
      <a
        className={`${styles.taskButton} ${styles.taskButtonPrimary}`}
        href="https://github.com/aomi-labs/arc-canteen/tree/main/packages/task-client"
        rel="noreferrer"
        target="_blank"
      >
        {quickstart ? "Open source ↗" : "View Task client ↗"}
      </a>
      <a
        className={styles.taskButton}
        href="https://arc-canteen.aomi.dev/execution-kit"
        rel="noreferrer"
        target="_blank"
      >
        {quickstart ? "Integration guide ↗" : "Execution Kit ↗"}
      </a>
    </div>
  );
}

function TaskQuickstart() {
  return (
    <>
      <section className={styles.taskBuilder}>
        <div className={styles.taskPanel}>
          <header className={styles.taskPanelHeader}>
            <span>Task client</span>
            <span>TypeScript</span>
          </header>
          <TaskCode />
          <TaskLinks />
        </div>
        <div className={styles.taskPanel}>
          <header className={styles.taskPanelHeader}>
            <span>Production quickstart</span>
            <span>Arc Mainnet</span>
          </header>
          <div className={styles.taskQuickstart}>
            <h3>From intent to execution</h3>
            <p>
              The client keeps authorization, payment and execution explicit.
            </p>
            <ol>
              {quickstartSteps.map(([title, description]) => (
                <li key={title}>
                  <div>
                    <strong>{title}</strong>
                    <span>{description}</span>
                  </div>
                </li>
              ))}
            </ol>
            <TaskLinks quickstart />
          </div>
        </div>
      </section>
      <p className={styles.taskDisclaimer}>
        <strong>Three approvals remain separate.</strong> The buyer’s wallet
        authorizes the Task request, pays for the service artifact and signs the
        final transaction independently.
      </p>
    </>
  );
}

export function TaskApiResearchBody({
  body,
  components,
}: {
  body: string;
  components: Components;
}) {
  return body.split(richBlockPattern).map((part, index) => {
    if (part === "::task-api-alice::") {
      return <AliceExample key={part} />;
    }

    if (part === "::task-api-quickstart::") {
      return <TaskQuickstart key={part} />;
    }

    return (
      <ReactMarkdown
        components={components}
        key={`${index}-${part.slice(0, 24)}`}
        remarkPlugins={[remarkGfm]}
      >
        {part}
      </ReactMarkdown>
    );
  });
}
