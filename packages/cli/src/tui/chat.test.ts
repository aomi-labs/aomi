// @vitest-environment node
import { expect, it, vi } from "vitest";

const screen = vi.hoisted(() => ({
  editor: undefined as
    | undefined
    | { onSubmit: (text: string) => void; text: string },
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
    text = "";
    constructor() {
      screen.editor = this;
    }
    setAutocompleteProvider() {}
    getText() {
      return this.text;
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
  isWatched: vi.fn(() => false),
  signsWith: vi.fn(),
  startWatching: vi.fn(),
}));
vi.mock("../commands/tx", () => ({
  follow: vi.fn(async () => ({})),
  reviewLines: vi.fn(),
  reviewSummary: vi.fn(),
  saveExport: vi.fn((view: { commit_id: string }) => `/x/${view.commit_id}`),
  signable: vi.fn(),
}));

import { connect } from "../context";
import { follow, saveExport, signable } from "../commands/tx";
import { isWatched } from "../commands/wallets";
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

it("exports each watched commit in turn, not the first one again", async () => {
  vi.mocked(isWatched).mockReturnValue(true);
  const commit = (ref: string) => ({
    ref,
    state: "needs_signature",
    kind: "svm_tx",
    view: { signer: "Vault1111", commit_id: ref },
    settlement: { done: false },
    get next() {
      return { canSign: () => false };
    },
    subscribe: () => () => {},
    close() {},
  });
  const send = vi.fn(() =>
    Object.assign(
      Promise.resolve({
        threadId: "t",
        title: "Move",
        reply: "Ready",
        commits: [commit("a"), commit("b")],
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
  const finished = runTui({});
  try {
    await vi.waitFor(() => expect(screen.editor).toBeDefined());
    screen.editor!.onSubmit("move it");
    await vi.waitFor(() =>
      expect(screen.input?.("e")).toEqual({ consume: true }),
    );
    screen.input?.("e");
    expect(
      vi.mocked(saveExport).mock.calls.map(([view]) => view.commit_id),
    ).toEqual(["a", "b"]);
  } finally {
    vi.mocked(isWatched).mockReturnValue(false);
    screen.input?.("ctrl+c");
    await finished;
  }
});

it("ignores s on a watched commit without typing it, so e still exports", async () => {
  vi.mocked(isWatched).mockReturnValue(true);
  const commit = (ref: string) => ({
    ref,
    state: "needs_signature",
    kind: "svm_tx",
    view: { signer: "Vault1111", commit_id: ref },
    settlement: { done: false },
    get next() {
      return { canSign: () => false };
    },
    subscribe: () => () => {},
    close() {},
  });
  const send = vi.fn(() =>
    Object.assign(
      Promise.resolve({
        threadId: "t",
        title: "Move",
        reply: "Ready",
        commits: [commit("a"), commit("b")],
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
  const finished = runTui({});
  try {
    await vi.waitFor(() => expect(screen.editor).toBeDefined());
    screen.editor!.onSubmit("move it");
    // A key the listener does not consume is typed into the composer.
    const press = (key: string) => {
      if (!(screen.input?.(key) as { consume?: boolean } | undefined)?.consume)
        screen.editor!.text += key;
    };
    // d (details) is consumed only once a commit box is up.
    await vi.waitFor(() =>
      expect(screen.input?.("d")).toEqual({ consume: true }),
    );
    vi.mocked(saveExport).mockClear();
    press("s");
    press("e");
    expect(saveExport).toHaveBeenCalledTimes(1);
    expect(screen.editor!.text).toBe("");
  } finally {
    vi.mocked(isWatched).mockReturnValue(false);
    screen.input?.("ctrl+c");
    await finished;
  }
});
