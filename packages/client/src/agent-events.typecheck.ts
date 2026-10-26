import type { ActionRequest, Event, EventPage, MessageEvent } from "./";
import type { EvmCommitMessage } from "./commits";

const toolResult: NonNullable<MessageEvent["tool_result"]> = ["task", "result"];
// @ts-expect-error Canonical inline tool results have exactly two strings.
const invalidTuple: NonNullable<MessageEvent["tool_result"]> = [
  "task",
  "result",
  "extra",
];
// @ts-expect-error Both canonical tuple entries are strings.
const invalidValue: NonNullable<MessageEvent["tool_result"]> = ["task", 42];
const pageEvents = (page: EventPage): Event[] => page.events;

type SigningRequest = Extract<ActionRequest, { type: "sign" }>;
const signingDetails: Pick<
  SigningRequest,
  "domain" | "payloads" | "requestKind"
> = {
  domain: { chainId: 1, name: "Consumer" },
  payloads: [
    { kind: "evm_typed_data", typed_data: { message: { value: "1" } } },
  ],
  requestKind: "typed_data",
};
type SvmInstruction = Extract<
  ActionRequest,
  { type: "execute_svm" }
>["transactions"][number]["instructions"][number];
const instruction: SvmInstruction = {
  payer: "payer",
  cluster: "devnet",
  program_id: "program",
  accounts: [{ pubkey: "account", is_signer: true, is_writable: false }],
  data_base64: "AA==",
  description: "Consumer instruction",
  kind: "transfer",
};
const invalidAccount: SvmInstruction["accounts"][number] = {
  pubkey: "account",
  // @ts-expect-error SVM account metadata retains boolean flags.
  is_signer: "yes",
  is_writable: false,
};
// A full EIP-712 permit is a valid typed-data message.
const permit: EvmCommitMessage = {
  format: "typed_data",
  typed_data: {
    domain: { name: "USD Coin", chainId: 8453 },
    types: { Permit: [{ name: "spender", type: "address" }] },
    primaryType: "Permit",
    message: { spender: "0x123" },
  },
};
void [
  permit,
  toolResult,
  invalidTuple,
  invalidValue,
  pageEvents,
  signingDetails,
  instruction,
  invalidAccount,
];
