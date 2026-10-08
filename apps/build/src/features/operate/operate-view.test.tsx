import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { truncateAddress } from "./format";
import { OperateView } from "./operate-view";

const operateFetch = vi.fn();
const operatePaymentsFetch = vi.fn();
const searchParams = { current: new URLSearchParams("") };

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.current,
  useRouter: () => ({ prefetch: vi.fn() }),
}));

vi.mock("@/components/control-plane/github-session-context", () => ({
  useGitHubSession: () => ({
    account: {
      loading: false,
      signedIn: true,
      githubLogin: "gordian",
      githubAvatarUrl: null,
      installationId: null,
    },
  }),
}));

vi.mock("./client", () => ({
  operateFetch: (...args: unknown[]) => operateFetch(...args),
  operatePaymentsFetch: (...args: unknown[]) => operatePaymentsFetch(...args),
}));

function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("truncateAddress", () => {
  it("shortens long hex addresses and leaves short values alone", () => {
    expect(truncateAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe(
      "0x1234…5678",
    );
    expect(truncateAddress("0xabc")).toBe("0xabc");
    expect(truncateAddress("")).toBe("");
    expect(truncateAddress(null)).toBe("");
  });
});

describe("OperateView transactions", () => {
  beforeEach(() => {
    operateFetch.mockReset();
    operatePaymentsFetch.mockReset();
    operatePaymentsFetch.mockResolvedValue({ payments: null });
    searchParams.current = new URLSearchParams("");
  });

  it("renders denser columns from wire fields and truncates addresses", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      transactions: [
        {
          id: "1",
          application: "demo",
          status: "confirmed",
          chainId: 8453,
          fromAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          toAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "1000000000000000000",
          description: "Swap USDC",
          txHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          createdAt: 1_700_000_000,
        },
      ],
      nextCursor: null,
    });

    render(<OperateView kind="transactions" />);

    await waitFor(() => {
      expect(screen.getAllByText("demo").length).toBeGreaterThan(0);
    });

    expect(screen.getByText("From")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("0xaaaa…aaaa")).toBeInTheDocument();
    expect(screen.getByText("0xbbbb…bbbb")).toBeInTheDocument();
    expect(screen.getByText("0xcccc…cccc")).toBeInTheDocument();
    expect(screen.getByText("1000000000000000000")).toBeInTheDocument();
    expect(screen.getByText("Swap USDC")).toBeInTheDocument();
  });

  it("shows a clearer empty state when there are no transactions", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      transactions: [],
      nextCursor: null,
    });

    render(<OperateView kind="transactions" />);

    await waitFor(() => {
      expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /open projects/i }),
    ).toHaveAttribute("href", "/projects");
  });

  it("renders 24h trend tiles and error split when the manager emits them", async () => {
    operatePaymentsFetch.mockResolvedValue({
      payments: {
        available: true,
        summary: {
          pricedCalls: 1,
          accruedUsd: 1,
          settledUsd: 0,
          outstandingUsd: 1,
        },
        resources: [],
      },
    });
    operateFetch.mockResolvedValue({
      projects: [],
      monitoring: { status: "ok", windowSeconds: 900 },
      apps: [
        {
          applicationId: 77,
          application: "goal-digger",
          status: "healthy",
          releaseTag: "apps-1-r0123abcdef-goal-digger-bbbbbbbbbbbb",
          sdkVersion: "3.0.2",
          metrics: {
            available: true,
            chats24h: 47,
            toolCalls24h: 130,
            transactions24h: 12,
            chatsHourly: [0, 3, 5],
            errorRate: 0.025,
            toolErrorRate: 0.12,
            txErrorRate: 0,
            p95LatencyMs: 1234,
            inflightRequests: 3,
            coldStartMs: 1250,
            dylibBytes: 4718592,
          },
        },
      ],
      dashboardLinks: [],
      platformMetrics: [],
      payments: {
        available: true,
        summary: {
          pricedCalls: 1,
          accruedUsd: 1,
          settledUsd: 0,
          outstandingUsd: 1,
        },
        resources: [],
      },
    });

    render(<OperateView kind="observability" />);

    await waitFor(() => {
      expect(screen.getByText("goal-digger")).toBeInTheDocument();
    });

    // Counts lead; the requests/min tile is replaced by the trend row.
    expect(screen.getByText("Chats 24h")).toBeInTheDocument();
    expect(screen.getByText("47")).toBeInTheDocument();
    expect(screen.getByText("130")).toBeInTheDocument();
    expect(screen.getByText("Tx 24h")).toBeInTheDocument();
    expect(screen.queryByText("Requests/min")).not.toBeInTheDocument();
    // Three failure domains, separately.
    expect(screen.getByText("Chat errors")).toBeInTheDocument();
    expect(screen.getByText("2.5%")).toBeInTheDocument();
    expect(screen.getByText("Tool errors")).toBeInTheDocument();
    expect(screen.getByText("12.0%")).toBeInTheDocument();
    expect(screen.getByText("Tx failures")).toBeInTheDocument();
    expect(
      screen.getByText(
        "24h activity · outstanding is the live recipient-bucket balance",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Outstanding").nextElementSibling).toHaveClass(
      "text-amber-500",
    );
    // Lifecycle footer.
    expect(
      screen.getByText(/SDK 3\.0\.2 · cold start 1250 ms · 4\.5 MB/),
    ).toBeInTheDocument();
  });

  it("links an owned app card to its live detail by stable ids", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      example: true,
      monitoring: { status: "unconfigured", windowSeconds: 300 },
      apps: [
        {
          applicationId: 2_937_099,
          application: "playground-example",
          exampleFixture: "goal-digger",
          project: { id: 1586 },
          status: "healthy",
          metrics: { chats24h: 47 },
        },
      ],
      dashboardLinks: [],
      platformMetrics: [],
    });

    render(<OperateView kind="observability" />);

    expect(
      await screen.findByRole("link", {
        name: "Open playground-example observability details",
      }),
    ).toHaveAttribute("href", "/operate/observability/2937099");
  });

  it("falls back to the legacy live tiles when trend data is absent", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      monitoring: { status: "ok", windowSeconds: 300 },
      apps: [
        {
          applicationId: 78,
          application: "playground-example",
          status: "healthy",
          metrics: {
            available: true,
            requestsPerMinute: 42,
            errorRate: 0.025,
            p95LatencyMs: 1234,
            inflightRequests: 3,
          },
        },
      ],
      dashboardLinks: [],
      platformMetrics: [],
    });

    render(<OperateView kind="observability" />);

    await waitFor(() => {
      expect(screen.getByText("playground-example")).toBeInTheDocument();
    });
    expect(screen.getByText("Requests/min")).toBeInTheDocument();
    expect(screen.getByText("Error rate")).toBeInTheDocument();
    expect(screen.queryByText("Chats 24h")).not.toBeInTheDocument();
    expect(screen.queryByText("Tool errors")).not.toBeInTheDocument();
  });

  it("expands a tx row into the receipt detail with SVM vocabulary", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      transactions: [
        {
          id: "tx-svm",
          application: "goal-digger",
          status: "failed",
          family: "svm",
          chainName: "Solana",
          chainId: 0,
          fromAddress: "7fUAJdStEuGbc3sM84cKRL6yYaaSstyLSU4ve5oovLS7",
          toAddress: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
          toLabel: "Raydium AMM v4",
          value: "4.0 SOL",
          description: "Swap 4 SOL to BONK",
          txHash: "4kNwPz2eXcRv9qLtB1sJdYgFmA7oHiU3TnKehM6ybWaGr8CQ",
          slot: "289,432,881",
          txFee: "0.000012 SOL",
          computeUnits: "41,022",
          computeLimit: "200,000",
          revertReason:
            "custom program error 0x1771 — SlippageToleranceExceeded",
          createdAt: 1_700_000_000,
        },
      ],
      nextCursor: null,
    });

    render(<OperateView kind="transactions" />);
    await waitFor(() => {
      expect(screen.getByText("Solana")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Swap 4 SOL to BONK"));
    expect(screen.getByText("Signature")).toBeInTheDocument();
    expect(screen.getByText("Slot")).toBeInTheDocument();
    expect(screen.getByText("Program")).toBeInTheDocument();
    expect(screen.getByText(/SlippageToleranceExceeded/)).toBeInTheDocument();
    expect(screen.getByText(/41,022 CU of 200,000/)).toBeInTheDocument();
    // Privacy ruling: intents never render.
    expect(screen.getByText("hidden · user privacy")).toBeInTheDocument();
  });

  it("renders invocation log records dense and expands args/result", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      logs: [
        {
          id: "log-1",
          occurredAt: 1_700_000_000,
          eventType: "tool_invocation",
          application: "goal-digger",
          summary: "SOL → USDC 2.5 · out 412.34",
          kind: "invocation",
          status: "ok",
          tool: "swap_quote",
          durationMs: 1840,
          threadId: "thread_af92c1",
          args: '{ "token_in": "SOL" }',
          result: '{ "amount_out": "412.34" }',
        },
        {
          id: "log-2",
          occurredAt: 1_699_990_000,
          eventType: "deployment",
          application: "goal-digger",
          summary: "Activated release r1dac12ad71",
        },
      ],
      nextCursor: null,
    });

    render(<OperateView kind="logs" />);
    await waitFor(() => {
      // Appears in both the tool filter and the record line.
      expect(screen.getAllByText("swap_quote").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("1840ms")).toBeInTheDocument();
    expect(
      screen.getByText("Activated release r1dac12ad71"),
    ).toBeInTheDocument();
    // Expand the invocation record.
    fireEvent.click(screen.getByText("SOL → USDC 2.5 · out 412.34"));
    expect(screen.getByText(/token_in/)).toBeInTheDocument();
    expect(screen.getByText(/amount_out/)).toBeInTheDocument();
  });

  it("shows the builder model key on funded usage logs", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      logs: [
        {
          id: "usage-1",
          occurredAt: 1_700_000_000,
          eventType: "usage",
          application: "goal-digger",
          summary: "Usage openai/gpt-5-nano",
          modelKey: {
            id: 7,
            label: "test-1",
            prefix: "sk-proj",
          },
        },
      ],
      nextCursor: null,
    });

    render(<OperateView kind="logs" />);

    expect(await screen.findByText("test-1 · sk-proj…")).toBeInTheDocument();
    expect(screen.getByText("Usage openai/gpt-5-nano")).toBeInTheDocument();
  });

  it("renders the statement when present, meter otherwise", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      daily: [],
      breakdown: [],
      // BFF filled the statement from example fixtures (BE not live yet).
      example: true,
      // BE statement vocabulary: subjects, entries, raw USD floats.
      statement: {
        range: { fromDate: "2026-07-01", toDate: "2026-07-15" },
        summary: {
          grossRevenue: 183.25,
          platformFees: 28.33,
          serviceCharges: 41.9,
          net: 113.02,
        },
        revenue: [
          {
            subject: "tool_invocation",
            application: "goal-digger",
            applicationId: 77,
            events: 128,
            gross: 128.0,
            platformFee: 12.8,
            net: 115.2,
          },
        ],
        charges: [
          {
            item: "hosting",
            application: "goal-digger",
            applicationId: 77,
            events: 1,
            amount: 10.0,
          },
        ],
        entries: [
          {
            day: "2026-07-15",
            application: "goal-digger",
            subject: "model",
            events: 68,
            gross: 4.1,
            platformFee: 0.37,
            net: -4.1,
          },
        ],
        payments: {
          available: true,
          scope: "recipient_bucket",
          summary: {
            accruedCredits: 100,
            accruedUsd: 1,
            settledCredits: 100,
            settledUsd: 1,
            outstandingCredits: 0,
            outstandingUsd: 0,
            pricedCalls: 1,
            settlements: 1,
          },
          resources: [
            {
              application: "somm-agent",
              applicationId: 2936606,
              tool: "get_idle_assets",
              flatCredits: 100,
              flatUsd: 1,
              beneficiary: "banana_evm",
              recipient: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
              chain: "eip155:84532",
              observedCalls: 1,
            },
          ],
          events: [
            {
              id: "settle:proof",
              kind: "settlement_confirmed",
              occurredAt: 1_700_000_001,
              application: "somm-agent",
              credits: 100,
              usd: 1,
              recipient: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
              paymentMethod: "coinbase",
              receiptId:
                "0x55e510bb72adb05979adc8afad8c70fa7ca3d0c2cb5dca9432bf82e46ff1df74",
              explorerUrl:
                "https://sepolia.basescan.org/tx/0x55e510bb72adb05979adc8afad8c70fa7ca3d0c2cb5dca9432bf82e46ff1df74",
            },
          ],
        },
      },
    });

    render(<OperateView kind="usage" />);
    await waitFor(() => {
      expect(screen.getByText("Gross revenue")).toBeInTheDocument();
    });
    // Floats format at render time; the period comes from the range.
    expect(screen.getByText("+$113.02")).toBeInTheDocument();
    expect(screen.getByText("Tool invocations")).toBeInTheDocument();
    expect(screen.getByText("$115.20")).toBeInTheDocument();
    expect(screen.getByText("App hosting")).toBeInTheDocument();
    expect(screen.getByText("Model usage")).toBeInTheDocument();
    expect(screen.getByText("−$4.10")).toBeInTheDocument();
    expect(screen.getAllByText("Jul 1 – Jul 15").length).toBeGreaterThan(0);
    expect(screen.getByText("Partner payments")).toBeInTheDocument();
    expect(
      screen.getByText("Partner payments").closest("#partner-payments"),
    ).toBeInTheDocument();
    expect(screen.getByText("Statement · Jul 1 – Jul 15")).toBeInTheDocument();
    expect(screen.getByText("Current outstanding")).toBeInTheDocument();
    expect(
      screen.getByText("Current outstanding").nextElementSibling,
    ).toHaveClass("text-emerald-500");
    expect(
      screen.getByText("all periods · recipient bucket"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("100.00 credits · statement period"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 receipt · statement period"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /liabilities owed to tool beneficiaries, not builder revenue/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("banana_evm")).not.toBeInTheDocument();
    expect(screen.getByText("get_idle_assets")).toBeInTheDocument();
    expect(screen.getByText("Settlement confirmed")).toBeInTheDocument();
    const receipt = screen.getByRole("link", { name: "0x55e5…df74" });
    expect(receipt).toHaveAttribute(
      "href",
      expect.stringContaining("sepolia.basescan.org/tx/"),
    );
    expect(receipt.querySelector("svg")).toBeInTheDocument();
    // example: true → the header labels the page as example data.
    expect(screen.getByText("Example data")).toBeInTheDocument();
  });

  it("renders partner settlement receipts as transaction records", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      transactions: [
        {
          id: "partner-payout:settle:proof",
          kind: "partner_payout",
          application: "somm-agent",
          status: "confirmed",
          family: "evm",
          chainName: "Base Sepolia",
          chainId: 84532,
          fromAddress: "",
          toAddress: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
          value: "1 USDC",
          valueUsd: "$1.00",
          description: "Partner settlement via Coinbase",
          method: "Coinbase x402",
          transfers: [],
          txHash:
            "0x55e510bb72adb05979adc8afad8c70fa7ca3d0c2cb5dca9432bf82e46ff1df74",
          createdAt: 1_700_000_001,
          payment: {
            credits: 100,
            recipient: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
            scope: "recipient_bucket",
          },
        },
      ],
      nextCursor: null,
    });

    render(<OperateView kind="transactions" />);

    expect(await screen.findByLabelText("Partner payout")).toHaveTextContent(
      "Payout",
    );
    expect(
      screen.queryByRole("columnheader", { name: "Kind" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass(
      "w-full",
      "min-w-[960px]",
      "table-fixed",
    );
    fireEvent.click(screen.getByText("Partner settlement via Coinbase"));
    expect(screen.getByText("Partner payment context")).toBeInTheDocument();
    expect(screen.getByText("Payer")).toBeInTheDocument();
    expect(screen.getByText("not recorded")).toBeInTheDocument();
    expect(screen.getByText("Settlement amount")).toBeInTheDocument();
    expect(screen.getByText("Coinbase x402")).toBeInTheDocument();
    expect(screen.queryByText("ERC-20 transfers")).not.toBeInTheDocument();
    expect(screen.getByText(/recipient bucket/i)).toBeInTheDocument();
  });

  it("filters and expands partner payment ledger records in logs", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      logs: [
        {
          id: "usage:fee",
          occurredAt: 1_700_000_000,
          eventType: "usage",
          application: "somm-agent",
          summary: "Partner fee accrued · 100.00 credits",
          details: {
            source: "partner_fee",
            credits_used: 100,
            recipient: "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
            billing: {
              items: [
                {
                  tool: "get_idle_assets",
                  credits: 100,
                  beneficiary: "banana_evm",
                  beneficiary_address:
                    "0x5D907BEa404e6F821d467314a9cA07663CF64c9B",
                },
              ],
            },
          },
        },
        {
          id: "ordinary",
          occurredAt: 1_699_999_999,
          eventType: "deployment",
          application: "somm-agent",
          summary: "Deployment activated",
          details: {},
        },
      ],
      nextCursor: null,
    });

    render(<OperateView kind="logs" />);
    expect(
      await screen.findByRole("button", { name: "Errors only" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Partner payments only" }),
    );

    expect(
      screen.getByText("Partner fee accrued · 100.00 credits"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear filters" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Deployment activated")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Partner fee accrued · 100.00 credits"));
    expect(
      screen.getByText(/awaiting recipient-bucket settlement/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Priced calls")).toBeInTheDocument();
    expect(screen.getByText("get_idle_assets")).toBeInTheDocument();
    expect(
      screen.getByText("100.00 credits", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/beneficiary_address/)).not.toBeInTheDocument();
    expect(screen.queryByText("banana_evm")).not.toBeInTheDocument();
  });

  it("falls back to the token meter without a statement", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      daily: [
        {
          periodUtcDay: "2026-07-15",
          application: "demo",
          inputTokens: 412000,
          outputTokens: 58400,
          creditsUsed: 3.4182,
        },
      ],
      breakdown: [],
      statement: null,
    });

    render(<OperateView kind="usage" />);
    await waitFor(() => {
      expect(screen.getByText("412,000")).toBeInTheDocument();
    });
    expect(screen.queryByText("Gross revenue")).not.toBeInTheDocument();
  });

  it("honors ?project= when loading operate data", async () => {
    searchParams.current = new URLSearchParams("project=42");
    operateFetch.mockResolvedValue({
      projects: [{ id: 42, repositoryLink: "a/b", apps: [] }],
      daily: [],
      breakdown: [],
    });

    render(<OperateView kind="usage" />);

    await waitFor(() => {
      expect(operateFetch).toHaveBeenCalledWith("usage", {
        projectId: 42,
      });
    });
  });

  it("ignores stale ?platform= on Project-scoped operate reads", async () => {
    searchParams.current = new URLSearchParams(
      "project=1620&platform=somm.finance",
    );
    operateFetch.mockResolvedValue({
      projects: [{ id: 1620, repositoryLink: "aomi/somm-agent", apps: [] }],
      daily: [],
      breakdown: [],
    });

    render(<OperateView kind="usage" />);

    await waitFor(() => {
      expect(operateFetch).toHaveBeenCalledWith("usage", {
        projectId: 1620,
      });
    });
  });

  it("reuses fresh operate data when returning to a tab", async () => {
    operateFetch.mockResolvedValue({
      projects: [],
      transactions: [],
      nextCursor: null,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = rtlRender(
      <QueryClientProvider client={client}>
        <OperateView kind="transactions" />
      </QueryClientProvider>,
    );

    await screen.findByText(/no transactions yet/i);
    first.unmount();
    rtlRender(
      <QueryClientProvider client={client}>
        <OperateView kind="transactions" />
      </QueryClientProvider>,
    );

    await screen.findByText(/no transactions yet/i);
    expect(operateFetch).toHaveBeenCalledTimes(1);
  });
});

describe("OperateView failure and empty states", () => {
  beforeEach(() => {
    operateFetch.mockReset();
    searchParams.current = new URLSearchParams("");
  });

  it("shows the normal empty state when the account has no transactions", async () => {
    operateFetch.mockResolvedValue({ projects: [], transactions: [] });

    render(<OperateView kind="transactions" />);

    expect(await screen.findByText(/No transactions yet/)).toBeTruthy();
  });

  // A total backend outage now surfaces as a BFF error, not an empty page
  // with a warning banner (and never as example data).
  it("shows the error state when the BFF reports the reads unavailable", async () => {
    operateFetch.mockRejectedValue(
      new Error("Operate reads are temporarily unavailable — retry shortly."),
    );

    render(<OperateView kind="transactions" />);

    expect(await screen.findByText(/temporarily unavailable/)).toBeTruthy();
    expect(screen.queryByText(/No transactions yet/)).toBeNull();
  });
});
