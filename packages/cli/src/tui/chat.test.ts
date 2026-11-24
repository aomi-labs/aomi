// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const screen = vi.hoisted(() => ({
  editor: undefined as undefined | { onSubmit: (text: string) => void },
  input: undefined as undefined | ((key: string) => unknown),
  updates: [] as object[],
  transcript: undefined as undefined | { render: (width: number) => string[] },
  list: undefined as
    | undefined
    | {
        items: { value: string; label: string }[];
        onSelect: (item: { value: string }) => void;
      },
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
      screen.transcript ??= child as typeof screen.transcript;
    }
    addInputListener(input: typeof screen.input) {
      screen.input = input;
    }
    removeChild() {}
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
  SelectList: class {
    onSelect = () => {};
    constructor(readonly items: { value: string; label: string }[]) {
      screen.list = this;
    }
    setSelectedIndex() {}
  },
  Markdown: class {
    render = () => [];
  },
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
  CliError: Error,
  agentsOf: async () => [
    { agent_id: 4, agent: "acme/prices", display_name: "Prices" },
  ],
  rpcReady: vi.fn(),
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
vi.mock("../commands/packages", () => ({
  keeps: (row: { id: string }, filter: { search: string }) =>
    row.id.includes(filter.search),
  notice: (row: { id: string }) => [`${row.id} may:`],
  packageLines: () => ["details"],
  packageState: () => "off",
  removal: () => "Remove?",
}));
vi.mock("../commands/wallets", () => ({ signsWith: vi.fn() }));
vi.mock("../commands/tx", () => ({
  metaLines: () => ["meta"],
  reviewed: (view: { version: number }) => view.version,
  reviewSummary: () => "1 EVM transaction",
}));

import { CommitStaleError } from "@aomi-labs/client";
import { connect, rpcReady } from "../context";
import { runTui } from "./chat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

beforeEach(() => {
  screen.editor = screen.transcript = screen.list = undefined;
});

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

describe("a commit that needs your signature", () => {
  const review = {
    type: "execute_evm",
    transactions: [
      {
        chain_id: 8453,
        from: "0xme",
        to: "0x00000000000000000000000000000000000000aa",
        data: "0x12345678",
        label: "Deposit\npool.deposit(amount: 2000000)",
        kind: "call",
      },
    ],
    simulation: {
      status: "passed",
      balanceChanges: [
        {
          account: "0xME",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "2000000",
          direction: "out",
          symbol: "USDC\u001b[2K",
          decimals: 6,
        },
      ],
      approvals: [],
      fees: [],
      warnings: [],
      guards: [],
      gas: null,
      logs: [],
    },
    transactionSafety: {
      assessment: {
        coverage: "partial",
        findings: [],
        limitations: [{ message: "The spender is not known" }],
      },
      decision: { eligibility: "eligible", bypassedFindingIds: [] },
      authority: { eligibility: "eligible" },
    },
  };

  async function open(sign = vi.fn(), local = true) {
    const commit = {
      ref: "c1",
      state: "needs_signature",
      kind: "evm_tx",
      signUrl: "https://chat.example/sign/c1",
      view: {
        commit_id: "c1",
        version: 3,
        state: "needs_signature",
        signer: "0xme",
        action: { kind: "sign" },
        batch: null,
      },
      review,
      batch: [{ commit_id: "c1" }],
      canSign: () => local,
      subscribe() {},
      close() {},
      sign,
      refresh: vi.fn(async () => {
        commit.view = { ...commit.view, version: 4 };
      }),
      settled: async () => ({ transaction_id: "0xhash" }),
      get next(): unknown {
        return commit;
      },
    };
    const turn = Promise.resolve({
      threadId: "t",
      title: "",
      reply: "",
      commits: [commit],
    });
    vi.mocked(connect).mockResolvedValue({
      auth: { mode: "guest" },
      agent: {
        thread: () => ({
          send: () => Object.assign(turn, { steps: async function* () {} }),
          history: async () => ({ activeWallet: {}, messages: [] }),
        }),
      },
    } as unknown as Awaited<ReturnType<typeof connect>>);
    const finished = runTui({});
    await vi.waitFor(() => expect(screen.editor).toBeDefined());
    screen.editor!.onSubmit("deposit");
    const drawn = () => screen.transcript!.render(80).join("\n");
    await vi.waitFor(() => expect(drawn()).toContain("Sign transaction"));
    return {
      commit,
      drawn,
      close: () => (screen.input?.("ctrl+c"), finished),
    };
  }

  it("shows the decoded steps, their effect and the guard line", async () => {
    const { drawn, close } = await open();
    expect(drawn()).toContain("1. Deposit");
    expect(drawn()).toContain("pool.deposit(amount: 2000000)");
    expect(drawn()).toContain("- send 2 USDC [2K (0x8335…2913)");
    expect(drawn()).toContain("Simulation passed");
    expect(drawn()).toContain("Partly covered: The spender is not known");
    expect(drawn()).not.toContain("meta");
    screen.input!("d");
    expect(drawn()).toContain("meta");
    await close();
  });

  it("signs what was drawn, after s and an explicit yes", async () => {
    const { commit, drawn, close } = await open();
    screen.input!("s");
    expect(screen.list!.items[0]).toEqual({ value: "no", label: "Cancel" });
    // Keys belong to the list now: the rest of a typed word decides nothing.
    expect(screen.input!("r")).toBeUndefined();
    // It changes while the list is open.
    commit.view = { ...commit.view, version: 9 };
    drawn();
    expect(commit.sign).not.toHaveBeenCalled();
    screen.list!.onSelect({ value: "yes" });
    await vi.waitFor(() =>
      expect(commit.sign).toHaveBeenCalledExactlyOnceWith(undefined, 3),
    );
    await vi.waitFor(() => expect(drawn()).toContain("Confirmed · 0xhash"));
    await close();
  });

  it("shows a commit that changed again instead of signing it", async () => {
    const { commit, drawn, close } = await open(
      vi.fn(async () => {
        throw new CommitStaleError("commit_version_conflict", "stale");
      }),
    );
    screen.input!("s");
    screen.list!.onSelect({ value: "yes" });
    await vi.waitFor(() =>
      expect(drawn()).toContain("It changed; review it again"),
    );
    expect(commit.refresh).toHaveBeenCalled();
    expect(drawn()).toContain("Sign transaction");
    expect(commit.sign).toHaveBeenCalledTimes(1);
    await close();
  });

  it("signs nothing until its RPC is ready, and takes one with /rpc", async () => {
    vi.mocked(rpcReady).mockImplementationOnce(
      async (_flags, _view, missing) => {
        await missing("eip155:8453");
      },
    );
    const { commit, drawn, close } = await open();
    screen.input!("s");
    screen.list!.onSelect({ value: "yes" });
    await vi.waitFor(() => expect(drawn()).toContain("/rpc <url>"));
    expect(commit.sign).not.toHaveBeenCalled();
    screen.editor!.onSubmit("/rpc https://rpc.example/");
    await vi.waitFor(() => expect(drawn()).toContain("RPC saved"));
    screen.input!("s");
    screen.list!.onSelect({ value: "yes" });
    await vi.waitFor(() => expect(commit.sign).toHaveBeenCalledTimes(1));
    await close();
  });

  it("offers only the sign page without a local key", async () => {
    const { commit, drawn, close } = await open(vi.fn(), false);
    expect(drawn()).toContain("your wallet, on the sign page");
    expect(screen.input!("s")).toBeUndefined();
    expect(screen.list).toBeUndefined();
    expect(commit.sign).not.toHaveBeenCalled();
    await close();
  });
});

describe("packages and agents", () => {
  const vault = {
    package_id: 9,
    id: "acme/vault",
    display_name: "Vault",
    chains: [],
    available: true,
    enabled: false,
    removable: true,
  };

  async function open() {
    const store = {
      list: vi.fn(async () => ({
        packages: [vault, { ...vault, package_id: 1, id: "acme/other" }],
      })),
      activate: vi.fn(async () => vault),
      setChoice: vi.fn(async () => vault),
      remove: vi.fn(async () => ({ removed: true })),
    };
    const send = vi.fn((..._args: unknown[]) =>
      Object.assign(new Promise(() => {}), {
        steps: async function* () {
          await new Promise(() => {});
        },
      }),
    );
    vi.mocked(connect).mockResolvedValue({
      auth: { mode: "account" },
      account: {
        packages: store,
        guard: { get: async () => ({ mode: "balanced" }) },
        wallets: { list: async () => [] },
        credits: { get: async () => null },
      },
      agent: { thread: () => ({ send }) },
    } as unknown as Awaited<ReturnType<typeof connect>>);
    const flags: { agent?: string } = {};
    const finished = runTui(flags);
    await vi.waitFor(() => expect(screen.editor).toBeDefined());
    const choose = async (value: string) => {
      const list = await vi.waitFor(() => {
        expect(screen.list?.items.map((item) => item.value)).toContain(value);
        return screen.list!;
      });
      list.onSelect({ value });
    };
    return {
      store,
      flags,
      choose,
      slash: screen.editor!.onSubmit,
      drawn: () => screen.transcript!.render(80).join("\n"),
      close: () => (screen.input?.("ctrl+c"), finished),
    };
  }

  it("turns a searched package on only after its notice and a yes", async () => {
    const { store, slash, choose, drawn, close } = await open();
    slash("/library vault");
    await choose("acme/vault");
    expect(screen.list!.items.map((item) => item.value)).toEqual([
      "Show",
      "Turn on",
      "Remove",
    ]);
    await choose("Turn on");
    expect(drawn()).toContain("acme/vault may:");
    expect(screen.list!.items[0]!.label).toBe("Cancel");
    expect(store.setChoice).not.toHaveBeenCalled();
    await choose("yes");
    await vi.waitFor(() => expect(drawn()).toContain("acme/vault is on"));
    expect(store.setChoice).toHaveBeenCalledWith(9, true, {});
    await close();
  });

  it("adds a package with its code, off until accepted, and removes one", async () => {
    const { store, slash, choose, drawn, close } = await open();
    slash("/library add s3cret");
    await choose("no");
    expect(store.activate).toHaveBeenCalledWith("s3cret");
    expect(drawn()).toContain("acme/vault is added, but off");
    expect(store.setChoice).not.toHaveBeenCalled();
    slash("/library vault");
    await choose("acme/vault");
    await choose("Remove");
    await choose("yes");
    await vi.waitFor(() => expect(drawn()).toContain("acme/vault is removed"));
    expect(store.remove).toHaveBeenCalledWith(9);
    await close();
  });

  it("pins an agent and goes back to Auto", async () => {
    const { flags, slash, choose, drawn, close } = await open();
    slash("/agent");
    await choose("acme/prices");
    expect(flags.agent).toBe("acme/prices");
    await vi.waitFor(() => expect(drawn()).toContain("Agent acme/prices"));
    slash("/agent not a slug");
    await vi.waitFor(() => expect(drawn()).toContain("publisher/name"));
    expect(flags.agent).toBe("acme/prices");
    // One command at a time: the last may still be finishing.
    await vi.waitFor(() => {
      slash("/agent auto");
      expect(flags.agent).toBeUndefined();
    });
    await close();
  });
});
