import type { ActionRequest, Event, EventPage, MessageEvent } from "../src";

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
  "calls" | "fees" | "domain" | "payloads" | "requestKind"
> = {
  calls: [{ to: "0x123", value: "0", data: "0x" }],
  fees: [{ asset: { kind: "native" }, amount: "1", recipient: "0x456" }],
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
const invalidCall: NonNullable<SigningRequest["calls"]>[number] = {
  to: "0x123",
  // @ts-expect-error Generated signing calls require a string value.
  value: 0,
};
const invalidAccount: SvmInstruction["accounts"][number] = {
  pubkey: "account",
  // @ts-expect-error SVM account metadata retains boolean flags.
  is_signer: "yes",
  is_writable: false,
};
void [
  toolResult,
  invalidTuple,
  invalidValue,
  pageEvents,
  signingDetails,
  instruction,
  invalidCall,
  invalidAccount,
];
