// Deterministic agent turns. A spec picks a turn by putting a marker in the
// message it sends, so the same spec text works against the route mock and
// the standalone server without any per-test configuration.
import type { EventBody } from "./protocol";

export const markers = {
  tool: "[tool]",
  tx: "[tx]",
  pay: "[pay]",
  slow: "[slow]",
  notify: "[notify]",
} as const;

export type ScenarioName = keyof typeof markers | "reply";

export function scenarioFor(message: string): ScenarioName {
  for (const [name, marker] of Object.entries(markers))
    if (message.includes(marker)) return name as ScenarioName;
  return "reply";
}

export const replyText = (message: string) => `Fake reply: ${message}`;
export const editedReplyText = (message: string) =>
  `Fake edited reply: ${message}`;
export const rerunReplyText = (message: string) =>
  `Fake rerun reply: ${message}`;
export const fakeTxFrom = "0x00000000000000000000000000000000000a0a0a";

/** Events after the user message for one turn. `undefined` terminal = held open. */
export function turnBody(
  scenario: ScenarioName,
  message: string,
  turn: number,
  answer = replyText(message),
  transactionFrom = fakeTxFrom,
  transactionText = "Review the simulated transfer before signing.",
): { events: EventBody[]; terminal: "complete" | "awaiting_action" | null } {
  const processing: EventBody = {
    type: "turn_state_changed",
    state: "processing",
  };
  switch (scenario) {
    case "tool":
      return {
        events: [
          processing,
          {
            type: "tool_update",
            id: `tool-${turn}`,
            call_id: `call-${turn}`,
            tool_name: "get_balance",
            result: { status: "working" },
          },
          {
            type: "tool_complete",
            id: `tool-${turn}`,
            call_id: `call-${turn}`,
            tool_name: "get_balance",
            result: { balance: "1.5", symbol: "ETH" },
          },
          {
            type: "message",
            sender: "agent",
            content: answer,
            message_key: `answer-${turn}`,
          },
        ],
        terminal: "complete",
      };
    case "tx":
      return {
        events: [
          {
            type: "message",
            sender: "agent",
            content: transactionText,
            message_key: `answer-${turn}`,
          },
          {
            type: "action",
            id: `action-${turn}`,
            revision: 1,
            state: "pending",
            request: {
              type: "execute_evm",
              transactions: [
                {
                  chain_id: 84532,
                  from: transactionFrom,
                  to: "0x000000000000000000000000000000000000dEaD",
                  value: "1",
                  data: "0x",
                  label: "Send 1 wei",
                  kind: "transfer",
                  broadcaster: "wallet",
                },
              ],
              simulation: {
                status: "passed",
                balanceChanges: [
                  {
                    account: transactionFrom,
                    asset: "native",
                    amount: "1",
                    direction: "out",
                    symbol: "ETH",
                    standard: "native",
                    chainId: 84532,
                  },
                ],
                approvals: [],
                fees: [],
                gas: {
                  units: "21000",
                  priceWei: "1000000000",
                  nativeCost: "21000000000000",
                },
                guards: [],
                logs: [],
                warnings: [],
              },
            },
            result: null,
            created_at: 1_700_000_000,
            expires_at: null,
          } as EventBody,
          { type: "turn_state_changed", state: "awaiting_action" },
        ],
        terminal: "awaiting_action",
      };
    case "slow":
      return {
        events: [
          processing,
          {
            type: "tool_update",
            id: `tool-${turn}`,
            call_id: `call-${turn}`,
            tool_name: "get_balance",
            result: { status: "working" },
          },
        ],
        terminal: null,
      };
    case "notify":
      return {
        events: [
          {
            type: "message",
            sender: "notice",
            content: "Fake notification: your transfer settled.",
            message_key: `notice-${turn}`,
          },
          {
            type: "message",
            sender: "agent",
            content: answer,
            message_key: `answer-${turn}`,
          },
        ],
        terminal: "complete",
      };
    case "pay":
    case "reply":
      return {
        events: [
          {
            type: "message",
            sender: "agent",
            content: answer,
            message_key: `answer-${turn}`,
          },
        ],
        terminal: "complete",
      };
  }
}

/** x402 v2 challenge the client's `wrapFetchWithPaymentChallenges` parses. */
export function paymentChallenge(resource: string) {
  return {
    x402Version: 2,
    error: "payment_required",
    resource: { url: resource, description: "Aomi chat turn" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        amount: "10000",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: "0x000000000000000000000000000000000000dEaD",
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}
