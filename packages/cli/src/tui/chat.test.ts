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
    addChild(child: unknown) {
      this.children.push(child);
    }
    addInputListener(input: typeof screen.input) {
      screen.input = input;
    }
    setFocus() {}
    requestRender() {}
    start() {}
    stop() {}
  },
  Editor: class {
    onSubmit = (_text: string) => {};
    constructor() {
      screen.editor = this;
    }
    setAutocompleteProvider() {}
    getText() {
      return "";
    }
    addToHistory() {}
  },
  SelectList: class {},
  Markdown: class {},
  truncateToWidth: (text: string) => text,
  visibleWidth: (text: string) => text.length,
  wrapTextWithAnsi: (text: string) => [text],
}));
vi.mock("./mentions", () => ({
  MentionAutocomplete: class {
    hint(text: string) {
      return text;
    }
  },
  mentionCatalog: async () => [],
  walletGroups: () => [],
}));
vi.mock("../state", () => ({
  loadState: () => ({}),
  updateState: (value: object) => screen.updates.push(value),
}));
vi.mock("../context", () => ({
  connect: vi.fn(),
  baseUrlOf: () => "https://chat.example",
  ownerOf: () => "guest",
  openUrl() {},
  turnOptions: (
    _aomi: unknown,
    _state: unknown,
    options: { thread: string },
  ) => ({ sessionId: options.thread }),
}));
vi.mock("../commands/account", () => ({ signIn: vi.fn() }));
vi.mock("../commands/guard", () => ({ guardMode: vi.fn() }));
vi.mock("../commands/wallets", () => ({
  isWatched: () => false,
  signsWith: vi.fn(),
  startWatching: vi.fn(),
}));
vi.mock("../commands/tx", () => ({
  follow: vi.fn(async () => ({})),
  reviewLines: vi.fn(),
  reviewSummary: vi.fn(),
  signable: vi.fn(),
}));

import { connect } from "../context";
import { follow, signable } from "../commands/tx";
import { runTui } from "./chat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

it("keeps /new from replacing a thread while its turn is running", async () => {
  screen.updates = [];
  const gate = deferred<void>();
  let thread = "";
  const send = vi.fn(() =>
    Object.assign(
      gate.promise.then(() => ({
        threadId: thread,
        title: "Original",
        reply: "Done",
        commits: [],
      })),
      {
        steps: async function* () {
          await gate.promise;
        },
        interrupt: vi.fn(),
      },
    ),
  );
  const aomi = {
    auth: { mode: "guest" },
    agent: {
      thread: vi.fn((id: string) => {
        thread = id;
        return { send, history: async () => ({ activeWallet: {} }) };
      }),
    },
  };
  vi.mocked(connect).mockResolvedValue(
    aomi as unknown as Awaited<ReturnType<typeof connect>>,
  );
  const finished = runTui({});
  try {
    await vi.waitFor(() => expect(screen.editor).toBeDefined());
    screen.editor!.onSubmit("hello");
    const original = thread;
    screen.editor!.onSubmit("/new");
    gate.resolve();
    await vi.waitFor(() =>
      expect(screen.updates).toContainEqual({
        thread: original,
        owner: "guest",
      }),
    );
    screen.editor!.onSubmit("again");
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(aomi.agent.thread.mock.calls.at(-1)?.[0]).toBe(original);
  } finally {
    screen.input?.("ctrl+c");
    await finished;
  }
});

it("signs a commit with the local key without leaving the chat", async () => {
  const commit = {
    ref: "commit-1",
    state: "ready",
    kind: "svm_tx",
    view: { signer: "So1anaSigner1111", chain_family: "svm" },
    settlement: { done: false },
    signUrl: "https://chat.example/sign/commit-1",
    get next() {
      return { canSign: () => true };
    },
    subscribe: () => () => {},
    settled: vi.fn(async () => ({ signature: "sig" })),
    close() {},
  };
  const send = vi.fn(() =>
    Object.assign(
      Promise.resolve({
        threadId: "t",
        title: "Flash",
        reply: "Ready to sign",
        commits: [commit],
      }),
      { steps: async function* () {}, interrupt: vi.fn() },
    ),
  );
  vi.mocked(connect).mockResolvedValue({
    auth: { mode: "guest" },
    agent: {
      thread: () => ({ send, history: async () => ({ activeWallet: {} }) }),
    },
  } as unknown as Awaited<ReturnType<typeof connect>>);
  const local = { close: vi.fn() };
  vi.mocked(signable).mockResolvedValue(
    local as unknown as Awaited<ReturnType<typeof signable>>,
  );
  const flags = { chain: 8453 };
  const finished = runTui(flags);
  try {
    await vi.waitFor(() => expect(screen.editor).toBeDefined());
    screen.editor!.onSubmit("refinance into Kamino");
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(screen.input?.("s")).toEqual({ consume: true }),
    );
    await vi.waitFor(() => expect(commit.settled).toHaveBeenCalled());
    expect(signable).toHaveBeenCalledWith(flags, "commit-1");
    expect(follow).toHaveBeenCalledWith(local, true);
    expect(local.close).toHaveBeenCalled();
  } finally {
    screen.input?.("ctrl+c");
    await finished;
  }
});
