// @vitest-environment node
import { expect, it, vi } from "vitest";

const screen = vi.hoisted(() => ({
  editor: undefined as undefined | { onSubmit: (text: string) => void },
  input: undefined as undefined | ((key: string) => unknown),
  updates: [] as object[],
}));
vi.mock("@earendil-works/pi-tui", () => ({
  decodeKittyPrintable: () => undefined,
  isKeyRelease: () => false,
  isKeyRepeat: () => false,
  matchesKey: (key: string, expected: string) => key === expected,
  ProcessTerminal: class {},
  TuiMainScreen: class {
    children: unknown[] = [];
    addChild(child: unknown) { this.children.push(child); }
    addInputListener(input: typeof screen.input) { screen.input = input; }
    setFocus() {}
    requestRender() {}
    start() {}
    stop() {}
  },
  Editor: class {
    onSubmit = (_text: string) => {};
    constructor() { screen.editor = this; }
    setAutocompleteProvider() {}
    getText() { return ""; }
    addToHistory() {}
  },
  SelectList: class {},
  Markdown: class {},
  truncateToWidth: (text: string) => text,
  visibleWidth: (text: string) => text.length,
  wrapTextWithAnsi: (text: string) => [text],
}));
vi.mock("./mentions", () => ({
  MentionAutocomplete: class { hint(text: string) { return text; } },
  mentionCatalog: async () => [],
  walletGroups: () => [],
}));
vi.mock("../state", () => ({ loadState: () => ({}), updateState: (value: object) => screen.updates.push(value) }));
vi.mock("../context", () => ({
  connect: vi.fn(),
  baseUrlOf: () => "https://chat.example",
  ownerOf: () => "guest",
  openUrl() {},
  turnOptions: (_aomi: unknown, _state: unknown, options: { thread: string }) => ({ sessionId: options.thread }),
}));
vi.mock("../commands/account", () => ({ signIn: vi.fn() }));
vi.mock("../commands/guard", () => ({ guardMode: vi.fn() }));
vi.mock("../commands/wallets", () => ({ signsWith: vi.fn() }));
vi.mock("../commands/tx", () => ({ reviewLines: vi.fn(), reviewSummary: vi.fn() }));

import { connect } from "../context";
import { runTui } from "./chat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

it("keeps /new from replacing a thread while its turn is running", async () => {
  screen.updates = [];
  const gate = deferred<void>();
  let thread = "";
  const send = vi.fn(() => Object.assign(
    gate.promise.then(() => ({ threadId: thread, title: "Original", reply: "Done", commits: [] })),
    { steps: async function* () { await gate.promise; }, interrupt: vi.fn() },
  ));
  const aomi = {
    auth: { mode: "guest" },
    agent: { thread: vi.fn((id: string) => { thread = id; return { send, history: async () => ({ activeWallet: {} }) }; }) },
  };
  vi.mocked(connect).mockResolvedValue(aomi as Awaited<ReturnType<typeof connect>>);
  const finished = runTui({});
  try {
    await vi.waitFor(() => expect(screen.editor).toBeDefined());
    screen.editor!.onSubmit("hello");
    const original = thread;
    screen.editor!.onSubmit("/new");
    gate.resolve();
    await vi.waitFor(() => expect(screen.updates).toContainEqual({ thread: original, owner: "guest" }));
    screen.editor!.onSubmit("again");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(aomi.agent.thread.mock.calls.at(-1)?.[0]).toBe(original);
  } finally {
    screen.input?.("ctrl+c");
    await finished;
  }
});
