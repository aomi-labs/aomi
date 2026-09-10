import { vi } from "vitest";
import type { Action, Event } from "@aomi-labs/client";

const runtime = vi.hoisted(() => ({
  pendingActions: [] as Action[],
  actionAttempts: new Map(),
  events: [] as Event[],
  isRunning: false,
  turnState: undefined as string | undefined,
  executeAction: vi.fn(),
  rejectAction: vi.fn(),
  showNotification: vi.fn(),
}));

vi.mock("@aomi-labs/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/react")>()),
  useAomiRuntime: () => runtime,
}));

vi.mock("@/components/assistant-ui/markdown-text", async () => {
  const { useMessagePartText } = await vi.importActual<
    typeof import("@assistant-ui/react")
  >("@assistant-ui/react");
  return {
    MarkdownText: () => {
      const { text } = useMessagePartText();
      const parts = text.split("**");
      return (
        <span className="aui-md">
          {parts.map((part, index) =>
            index % 2 ? <strong key={index}>{part}</strong> : part,
          )}
        </span>
      );
    },
  };
});

vi.mock("../../lib/capabilities/skill-catalog", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../lib/capabilities/skill-catalog")
  >()),
  useSkillCatalog: () => ({
    skills: [{ id: "aave", name: "aave" }],
    loading: false,
    error: null,
  }),
}));

vi.mock("../../lib/wallet-kit", () => ({
  useAomiWalletKit: () => ({
    supportedChains: [
      {
        id: 1,
        name: "Ethereum",
        nativeCurrency: { symbol: "ETH" },
      },
      { id: 8453, name: "Base", nativeCurrency: { symbol: "ETH" } },
    ],
  }),
}));

export function action(request: Action["request"]): Action {
  return {
    type: "action",
    event_id: "event-1",
    sequence: 1,
    turn_id: "turn-1",
    occurred_at: 1,
    id: "action-1",
    revision: 1,
    state: "pending",
    request,
    result: null,
    created_at: 1,
    expires_at: null,
  };
}

export function simulation(): Extract<
  Action["request"],
  { type: "execute_evm" }
>["simulation"] {
  return {
    status: "passed",
    balanceChanges: [],
    approvals: [],
    fees: [],
    gas: null,
    guards: [],
    logs: [],
    warnings: [],
  };
}

export { runtime };
