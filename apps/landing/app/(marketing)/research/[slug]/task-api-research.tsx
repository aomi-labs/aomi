import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "../../longform.module.css";

const richBlockPattern = /(::task-api-(?:alice|quickstart|flow)::)/;

const taskSteps = [
  "The agent pays 0.01 USDC to prepare the intent; Alice’s address is simulation input.",
  "The calls are simulated against pinned Arc state.",
  "Changed targets, excess spend, insufficient output or failed calls are rejected.",
  "The agent polls for a signed preview and checks the outcome and retrieval price.",
  "Retrieval payment and transaction execution remain separate approvals.",
];

const outcomeRows = [
  ["Order-book proceeds", "990.000 USDC"],
  ["Maximum Arc repurchase", "−940.500 USDC"],
  ["Gross trading edge", "49.500 USDC"],
  ["Preparation", "−0.010 USDC"],
  ["Retrieval: 3%", "−28.215 USDC"],
];

const launchCapabilities = [
  "0.01 USDC paid preparation",
  "Arc testnet paid E2E verified",
  "Signed preview and frozen bundle hash",
  "Separate preparation and retrieval receipts",
  "Unsigned native-USDC transaction bundles",
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
    "Purchase preparation",
    "Send an intent and constraints. Accept the 0.01 USDC x402 challenge to start the job.",
  ],
  [
    "Poll and inspect",
    "Free status checks return progress or a signed preview. Verify the effects, expiry, hash and retrieval price.",
  ],
  [
    "Retrieve within your budget",
    "Approve the second purchase at 3% of simulated outgoing USDC, or retrieve for free when outflow is zero.",
  ],
  [
    "Review before execution",
    "Verify the bundle bytes, then separately review and sign with your execution wallet.",
  ],
];

function TaskFlow() {
  return (
    <section
      className={styles.taskExample}
      aria-label="Two-purchase Task API flow"
    >
      <header className={styles.taskExampleHeader}>
        <p>Two purchases · separate execution</p>
        <h3>Intent → preparation → preview → bundle</h3>
      </header>
      <div className={styles.taskExampleCopy}>
        <ol className={styles.taskSteps}>
          <li>
            POST /build → 402 for 0.01 USDC → same-body paid retry → 202 +
            quoteId + private token
          </li>
          <li>
            POST /{`{quoteId}`}/status + token → free progress or signed preview
          </li>
          <li>
            POST /{`{quoteId}`}/result + token → 402 for 3% → same-body paid
            retry → frozen bundle
          </li>
          <li>
            Your wallet independently reviews, signs and submits. Zero outflow
            skips retrieval payment.
          </li>
        </ol>
        <p className={styles.taskFinePrint}>
          All paths are under /v1/task. Keep the retrieval token private.
          Neither service payment authorizes transaction execution.
        </p>
      </div>
    </section>
  );
}

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
            <h4>What the request constrains</h4>
            <p>
              Chain, wallet, exact pool and approval targets, maximum outgoing
              USDC, minimum EURC received, gas ceiling and call order. Once
              frozen, the unpaid bundle has a five-minute purchase window.
            </p>
            <ol className={styles.taskSteps}>
              {taskSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div className={styles.taskExampleMath}>
            <h4>Known before retrieval purchase</h4>
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
                  <td>21.275 USDC</td>
                </tr>
              </tbody>
            </table>
            <p className={styles.taskFinePrint}>
              Illustrative prices, not a claim about an available spread. The
              point is that simulation-verified execution and its price enter
              the agent’s decision before it buys the bundle; preparation is
              already paid.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.taskReality}>
        <div className={styles.taskLive}>
          <h3>Verified in acceptance</h3>
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
      <code>{`// Source example: examples/task-api/client.ts
// Configure endpoint, payer, merchant, trustedJwks,
// signer and a private journal before purchasing.
const client = new TaskClient({
  ...deploymentConfig,
  maxPreparationFeeMicrousd: 10_000n,
  maxRetrievalFeeMicrousd: 1_000n,
  maxTotalFeeMicrousd: 11_000n,
  waitMs: 90_000,
});

const result = await client.purchase({
  intent: "Transfer 0.01 USDC to " + recipient,
  chainId: 5042002, // Arc testnet
  sender,
  payer,
  constraints: {
    maxOutgoingUsdcWei: "10000000000000000",
  },
});

if (result.status === "complete") {
  // result.bytes is the verified unsigned bundle.
  // Review before signing with your own wallet.
}
// On timeout, keep the journal.
// recover() replays proofs without signing again.`}</code>
    </pre>
  );
}

function TaskLinks({ quickstart = false }: { quickstart?: boolean }) {
  return (
    <div className={styles.taskActions}>
      <a
        className={`${styles.taskButton} ${styles.taskButtonPrimary}`}
        href="https://github.com/aomi-labs/product-mono/tree/main/examples/task-api"
        rel="noreferrer"
        target="_blank"
      >
        {quickstart ? "Open source ↗" : "View Task client ↗"}
      </a>
      <a
        className={styles.taskButton}
        href="https://github.com/aomi-labs/product-mono/blob/main/examples/task-api/README.md"
        rel="noreferrer"
        target="_blank"
      >
        {quickstart ? "Integration guide ↗" : "Client guide ↗"}
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
            <span>Integration walkthrough</span>
            <span>Arc testnet</span>
          </header>
          <div className={styles.taskQuickstart}>
            <h3>From intent to execution</h3>
            <p>
              The client budgets both purchases and returns verified unsigned
              bytes.
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
        <strong>Payment is not execution authority.</strong> There is no
        TaskAuthorization signature. The payer buys preparation and retrieval;
        the execution wallet independently controls whether the bundle is signed
        and submitted.
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
    if (part === "::task-api-flow::") return <TaskFlow key={part} />;

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
