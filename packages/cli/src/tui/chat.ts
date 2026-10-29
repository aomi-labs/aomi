import {
  CombinedAutocompleteProvider,
  decodeKittyPrintable,
  Editor,
  isKeyRelease,
  isKeyRepeat,
  Markdown,
  matchesKey,
  ProcessTerminal,
  SelectList,
  truncateToWidth,
  TuiMainScreen,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type MarkdownTheme,
  type SelectItem,
} from "@earendil-works/pi-tui";
import {
  CHAIN_NAMES,
  modelLabel,
  TRANSACTION_SAFETY_NAMES,
  type Turn,
  type Aomi,
  type AomiAccountWallet,
  type AomiActiveWallet,
  type CommitHandle,
  type TransactionSafetyMode,
} from "@aomi-labs/client";
import { decode, type InterpretedToolStep } from "@aomi-labs/client/trace";
import packageJson from "../../package.json";
import type { ChatFlags } from "../commands/chat";
import { guardMode } from "../commands/guard";
import { reviewLines, reviewSummary } from "../commands/tx";
import { signIn } from "../commands/account";
import { signsWith } from "../commands/wallets";
import {
  baseUrlOf,
  connect,
  openUrl,
  ownerOf,
  turnOptions,
  type ShowCode,
} from "../context";
import { loadState, updateState } from "../state";
import { GLYPHS, chipsOf, paint, statusOf } from "../trace";

type TurnView = {
  text?: string;
  note?: string;
  /** A turn from the thread's history: its text and reply only. */
  past?: boolean;
  steps: InterpretedToolStep[];
  started: number;
  ms?: number;
  reply?: string;
  markdown?: Markdown;
  commits: CommitHandle[];
  /** Where your decision on its commit stands, as one line. */
  decision?: string;
  error?: string;
};

const MARKDOWN: MarkdownTheme = {
  heading: (text) => paint.bold(paint.cyan(text)),
  link: paint.cyan,
  linkUrl: paint.dim,
  code: paint.yellow,
  codeBlock: (text) => text,
  codeBlockBorder: paint.dim,
  quote: paint.dim,
  quoteBorder: paint.dim,
  hr: paint.dim,
  listBullet: paint.cyan,
  bold: paint.bold,
  italic: paint.italic,
  strikethrough: paint.strike,
  underline: paint.underline,
};

/** A reply as rendered markdown, parsed once per turn. */
function replyLines(turn: TurnView, width: number): string[] {
  turn.markdown ??= new Markdown(turn.reply ?? "", 0, 0, MARKDOWN);
  return turn.markdown.render(width);
}

const SLASH = [
  { name: "model", description: "Pick the model for this thread" },
  { name: "wallet", description: "Pick the wallet this thread trades with" },
  { name: "threads", description: "Continue another thread" },
  { name: "guard", description: "Strict, Balanced or Yolo for this thread" },
  { name: "new", description: "Start a new thread" },
  { name: "login", description: "Sign in with a device code" },
  { name: "help", description: "Keys and commands" },
  { name: "exit", description: "Quit" },
];

const HELP = [
  "/model [name | auto]   pick the model",
  "/wallet                the wallet this thread trades with, and how it signs",
  "/threads               continue another thread",
  "/guard [strict | balanced | yolo]  how guards gate this thread's actions",
  "/new                   start a new thread",
  "/login                 sign in with a device code",
  "esc stops a turn · ctrl+o expands steps · ctrl+c quits",
  "a r o d on an approval: approve, reject, open, details",
].join("\n");

const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The chat screen: turns with their steps, approvals, the input and a status bar. */
export async function runTui(flags: ChatFlags): Promise<void> {
  // Links render as clickable OSC 8 hyperlinks: terminals that lack them show
  // the text, and over SSH none of pi-tui's detection variables arrive.
  process.env.PI_HYPERLINKS ??= "1";
  /** A device sign-in in progress: drawn as a panel until it is approved. */
  let signing: { url: string; code: string } | undefined;
  const showCode: ShowCode = (prompt) => {
    signing = prompt;
    tui.requestRender();
  };
  let aomi = await connect(flags, showCode);
  // A new thread unless asked to continue one: `--thread <id>` or /threads.
  const resume = Boolean(flags.thread);
  let thread = flags.thread || crypto.randomUUID();
  let title = "new thread";
  const turns: TurnView[] = [];
  let running: Turn | undefined;
  /** ctrl+o opens or closes every turn's steps; until then only the latest is open. */
  let expanded: boolean | undefined;
  let details = false;
  const bar = { who: aomi.auth.mode === "guest" ? "guest" : "", credits: "" };
  let wallets: AomiAccountWallet[] = [];
  /** The thread's wallet per family, once the server reports it. */
  let active: AomiActiveWallet = {};
  /** A wallet picked before the thread's first turn, sent with that turn. */
  let walletPick: AomiActiveWallet | undefined;
  /** Whether the thread exists on the server (it has history). */
  let started = false;
  let guard: TransactionSafetyMode | undefined;
  const loadGuard = () =>
    aomi.auth.mode === "guest"
      ? undefined
      : void aomi.account.guard
          .get({ thread })
          .then((policy) => {
            guard = policy.mode;
            tui.requestRender();
          })
          .catch(() => undefined);

  const terminal = new ProcessTerminal();
  const tui = new TuiMainScreen(terminal);
  const listTheme = {
    selectedPrefix: paint.cyan,
    selectedText: paint.cyan,
    description: paint.dim,
    scrollInfo: paint.dim,
    noMatch: paint.dim,
  };
  const editor = new Editor(tui, {
    borderColor: paint.dim,
    selectList: listTheme,
  });

  /** A list above the input; enter picks, esc leaves things as they are. */
  function pick(
    items: SelectItem[],
    current: string,
    chosen: (value: string) => void,
  ) {
    const list = new SelectList(items, 10, listTheme);
    list.setSelectedIndex(
      Math.max(
        0,
        items.findIndex((item) => item.value === current),
      ),
    );
    const close = () => {
      tui.removeChild(list);
      tui.setFocus(editor);
      tui.requestRender();
    };
    list.onSelect = (item) => (close(), chosen(item.value));
    list.onCancel = close;
    tui.children.splice(tui.children.indexOf(editor), 0, list);
    tui.setFocus(list);
    tui.requestRender();
  }
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(SLASH, process.cwd()),
  );

  /** Commits you already approved or rejected: one decision each. */
  const deciding = new Set<string>();
  const pending = () =>
    turns
      .flatMap((turn) => turn.commits)
      .find(
        (commit) =>
          commit.state === "awaiting_approval" && !deciding.has(commit.ref),
      );

  const transcript: Component = {
    invalidate() {},
    render(width) {
      const lines = [
        paint.dim(`aomi ${packageJson.version} · thread "${title}"`),
      ];
      turns.forEach((turn, index) =>
        lines.push("", ...turnLines(turn, index === turns.length - 1, width)),
      );
      const commit = pending();
      if (commit)
        lines.push("", ...approveBox(commit, Math.min(width, 60), details));
      if (signing) lines.push("", ...signInBox(signing, width));
      lines.push("");
      return lines
        .flatMap((line) => wrapTextWithAnsi(line, width))
        .map((line) => truncateToWidth(line, width));
    },
  };

  function turnLines(turn: TurnView, last: boolean, width: number): string[] {
    if (turn.note) return turn.note.split("\n").map(paint.dim);
    if (turn.past)
      return [
        ...(turn.text
          ? [`${paint.cyan(paint.bold("›"))} ${turn.text}`, ""]
          : []),
        ...(turn.reply ? replyLines(turn, width) : []),
      ];
    const seconds = Math.round(
      ((turn.ms ?? Date.now() - turn.started) as number) / 1000,
    );
    const head =
      turn.ms === undefined
        ? `${paint.yellow("●")} ${paint.bold(`Working ${seconds}s`)}`
        : `${paint.green("●")} ${paint.bold(`Worked ${seconds}s`)}`;
    const lines = [`${paint.cyan(paint.bold("›"))} ${turn.text}`, ""];
    const open = turn.ms === undefined || (expanded ?? last);
    lines.push(
      `${head} ${paint.dim(`· ${turn.steps.length} step${turn.steps.length === 1 ? "" : "s"}`)}  ${paint.dim(`ctrl+o ${open ? "collapse" : "expand"}`)}`,
    );
    if (open)
      for (const step of turn.steps) {
        const status = statusOf(step);
        const glyph =
          status === "success"
            ? paint.green(GLYPHS.success)
            : status === "waiting"
              ? paint.yellow(GLYPHS.waiting)
              : paint.red(GLYPHS.failed);
        lines.push(
          `  ${glyph} ${step.title.padEnd(22)} ${paint.dim(chipsOf(step))}`,
        );
      }
    if (turn.reply) lines.push("", ...replyLines(turn, width));
    if (turn.error) lines.push("", paint.red(turn.error));
    for (const commit of turn.commits)
      if (
        commit.state !== "awaiting_approval" &&
        !["confirmed", "failed", "rejected", "expired"].includes(commit.state)
      )
        lines.push(
          "",
          `${paint.yellow("Sign it")}  aomi tx sign ${commit.ref}`,
        );
    if (turn.decision) lines.push("", turn.decision);
    return lines;
  }

  const status: Component = {
    invalidate() {},
    render(width) {
      const state = loadState();
      // The chain only reaches the agent when a local key signs.
      const chain = aomi.wallet?.evm && (flags.chain ?? state.chain);
      const wallet = wallets.find(
        (entry) => entry.id === (active.evm ?? active.svm),
      );
      const left = [
        // A local key signs everything itself; else the thread's wallet.
        aomi.wallet?.evm || aomi.wallet?.svm || !wallet
          ? bar.who
          : `${wallet.label} (${signsWith(wallet)})`,
        chain ? (CHAIN_NAMES[chain] ?? `chain ${chain}`) : undefined,
        state.model ? modelLabel(state.model) : "Auto model",
        guard && TRANSACTION_SAFETY_NAMES[guard].label,
        bar.credits,
      ]
        .filter(Boolean)
        .join(" · ");
      const right = `${running ? "esc stop" : "ctrl+c quit"} · /help`;
      const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
      return [
        truncateToWidth(paint.dim(`${left}${" ".repeat(gap)}${right}`), width),
      ];
    },
  };

  tui.addChild(transcript);
  tui.addChild(editor);
  tui.addChild(status);
  tui.setFocus(editor);

  const note = (text: string) => {
    turns.push({ note: text, steps: [], started: Date.now(), commits: [] });
    tui.requestRender();
  };

  let quit!: () => void;
  const done = new Promise<void>((resolve) => (quit = resolve));
  /** Aborted on quit: stops waits that would hold the process open. */
  const closing = new AbortController();
  const exit = () => {
    closing.abort();
    for (const turn of turns) for (const commit of turn.commits) commit.close();
    tui.stop();
    quit();
  };

  tui.addInputListener((data) => {
    // The kitty keyboard protocol also reports releases and repeats: act on presses.
    if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;
    if (matchesKey(data, "ctrl+c")) return (exit(), { consume: true });
    if (matchesKey(data, "escape") && running)
      return (void running.interrupt(), { consume: true });
    if (matchesKey(data, "ctrl+o")) {
      expanded = !(expanded ?? false);
      tui.requestRender();
      return { consume: true };
    }
    const key = decodeKittyPrintable(data) ?? data;
    if (signing && key === "o" && !editor.getText() && !pending()) {
      openUrl(signing.url);
      return { consume: true };
    }
    const commit = pending();
    if (!commit || editor.getText() || !/^[arod]$/.test(key)) return undefined;
    if (key === "o" && commit.signUrl) openUrl(commit.signUrl);
    if (key === "d") details = !details;
    if (key === "a" || key === "r") void decide(commit, key === "a");
    tui.requestRender();
    return { consume: true };
  });

  /** Approve or reject `commit` once, its progress on its turn's last line. */
  async function decide(commit: CommitHandle, approve: boolean) {
    const turn = turns.findLast((entry) => entry.commits.includes(commit));
    if (!turn || deciding.has(commit.ref)) return;
    deciding.add(commit.ref);
    const show = (line: string) => {
      turn.decision = line;
      tui.requestRender();
    };
    try {
      if (!approve) {
        await commit.reject();
        return show(paint.dim("✗ Rejected"));
      }
      show(paint.yellow("◐ Approving…"));
      // The agent answers once it settles; count what it has said so far.
      const said = aomi.agent
        .thread(thread)
        .history()
        .then((history) => history.messages.length)
        .catch(() => undefined);
      await commit.approve(commit.view);
      show(paint.yellow("◐ Signing and sending…"));
      const last = await commit.settled({ signal: closing.signal });
      show(
        paint.green(
          last.signature
            ? `✓ Signed · ${last.signature}`
            : `✓ Confirmed · ${last.transaction_url ?? last.transaction_id ?? ""}`,
        ),
      );
      void followUp(await said);
    } catch (error) {
      deciding.delete(commit.ref);
      show(paint.red(error instanceof Error ? error.message : String(error)));
    }
  }

  /** The agent's answer to a settled commit: it continues the thread on its own. */
  async function followUp(said: number | undefined) {
    if (said === undefined) return;
    const started = thread;
    for (
      let attempt = 0;
      attempt < 45 && thread === started && !closing.signal.aborted;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const history = await aomi.agent
        .thread(thread)
        .history()
        .catch(() => undefined);
      const fresh = history?.messages.slice(said) ?? [];
      if (!fresh.some((message) => message.sender === "agent")) continue;
      for (const message of fresh)
        if (message.sender === "agent")
          turns.push({
            past: true,
            reply: message.text,
            steps: [],
            started: 0,
            commits: [],
          });
      return tui.requestRender();
    }
  }

  async function send(text: string) {
    const view: TurnView = {
      text,
      steps: [],
      started: Date.now(),
      commits: [],
    };
    turns.push(view);
    const ticker = setInterval(() => tui.requestRender(), 1000);
    try {
      const options = turnOptions(aomi, loadState(), {
        thread,
        app: flags.app,
        model: flags.model,
        chain: flags.chain,
        walletPick: started ? undefined : walletPick,
      });
      thread = options.sessionId;
      running = aomi.agent.thread(thread).send(text, options);
      for await (const step of running.steps({ decode })) {
        signing = undefined;
        view.steps.push(step);
        tui.requestRender();
      }
      const result = await running;
      view.reply = result.reply;
      view.commits = result.commits;
      for (const commit of result.commits)
        commit.subscribe(() => tui.requestRender());
      title = result.title || title;
      updateState({ thread: result.threadId, owner: ownerOf(aomi) });
      started = true;
      walletPick = undefined;
      void loadWallet();
    } catch (error) {
      view.error = error instanceof Error ? error.message : String(error);
    } finally {
      clearInterval(ticker);
      signing = undefined;
      view.ms = Date.now() - view.started;
      running = undefined;
      tui.requestRender();
    }
  }

  async function slash(line: string) {
    const [name, ...rest] = line.slice(1).trim().split(/\s+/);
    const arg = rest.join(" ");
    if (name === "exit") return exit();
    if (name === "help") return note(HELP);
    if (name === "login") {
      if (aomi.auth.mode !== "guest") return note("Already signed in");
      try {
        await signIn(baseUrlOf(flags), showCode);
      } catch (error) {
        signing = undefined;
        return note(error instanceof Error ? error.message : String(error));
      }
      signing = undefined;
      aomi = await connect(flags, showCode);
      // The guest's threads stay with the guest.
      thread = crypto.randomUUID();
      title = "new thread";
      turns.length = 0;
      started = false;
      active = {};
      bar.who = "";
      loadGuard();
      void statusBar(aomi, bar).then((list) => {
        wallets = list;
        tui.requestRender();
      });
      return note("Signed in");
    }
    if (name === "new") {
      thread = crypto.randomUUID();
      title = "new thread";
      turns.length = 0;
      started = false;
      active = {};
      loadGuard();
      return note("New thread");
    }
    if (name === "threads") {
      const { threads } = await aomi.agent.threads
        .list({ limit: 30 })
        .catch(() => ({ threads: [] }));
      if (!threads.length) return note("No threads yet");
      return pick(
        threads.map((entry) => ({
          value: entry.id,
          label: entry.title || "Untitled chat",
          description: entry.id.slice(0, 8),
        })),
        thread,
        (id) => {
          thread = id;
          title = threads.find((entry) => entry.id === id)?.title || title;
          updateState({ thread: id, owner: ownerOf(aomi) });
          void loadThread();
          loadGuard();
        },
      );
    }
    if (name === "wallet") {
      if (aomi.auth.mode === "guest")
        return note("Sign in for wallets: /login");
      if (!wallets.length) return note("No wallets yet");
      return pick(
        wallets.map((entry) => ({
          value: entry.id,
          label: entry.label,
          description: `${entry.family.toUpperCase()} · ${signsWith(entry)} · ${short(entry.address)}`,
        })),
        active.evm ?? active.svm ?? "",
        (id) => void useWallet(id),
      );
    }
    if (name === "model") {
      const choose = (model: string) => {
        updateState({ model: model === "auto" ? undefined : model });
        note(`Model ${model === "auto" ? "Auto" : modelLabel(model)}`);
      };
      if (arg) return choose(arg);
      const models = await aomi.raw
        .getModels(thread ?? crypto.randomUUID())
        .catch(() => []);
      if (!models.length) return note("No models listed");
      return pick(
        [
          { value: "auto", label: "Auto", description: "the default model" },
          ...models.map((id) => ({
            value: id,
            label: modelLabel(id),
            description: id,
          })),
        ],
        loadState().model ?? "auto",
        choose,
      );
    }
    if (name === "guard") {
      if (aomi.auth.mode === "guest") return note("Sign in for guards: /login");
      const save = async (mode: TransactionSafetyMode) => {
        try {
          guard = (await aomi.account.guard.set({ mode, thread })).mode;
          note(`Guard ${TRANSACTION_SAFETY_NAMES[guard].label}`);
        } catch (error) {
          note(error instanceof Error ? error.message : String(error));
        }
      };
      // Yolo runs flagged actions too, so it asks first, as on the web.
      const choose = (mode: TransactionSafetyMode) =>
        mode === "unrestricted"
          ? pick(
              [
                {
                  value: "yes",
                  label: "Turn on Yolo for this thread",
                  description: "actions run even when a guard flags them",
                },
                { value: "no", label: "Cancel" },
              ],
              "no",
              (answer) => void (answer === "yes" && save(mode)),
            )
          : void save(mode);
      if (arg) {
        const mode = guardMode(arg);
        return mode ? choose(mode) : note("/guard strict | balanced | yolo");
      }
      return pick(
        (Object.keys(TRANSACTION_SAFETY_NAMES) as TransactionSafetyMode[]).map(
          (mode) => ({ value: mode, ...TRANSACTION_SAFETY_NAMES[mode] }),
        ),
        guard ?? "balanced",
        (mode) => choose(mode as TransactionSafetyMode),
      );
    }
    note(`Unknown command /${name}; /help`);
  }

  editor.onSubmit = (raw) => {
    const text = raw.trim();
    if (!text) return;
    editor.addToHistory?.(text);
    if (text.startsWith("/")) void slash(text);
    else if (running) note("Still working; esc stops it");
    else void send(text);
  };

  /** Make `id` the thread's wallet: now, or with the first turn of a new thread. */
  async function useWallet(id: string) {
    const wallet = wallets.find((entry) => entry.id === id);
    if (!wallet) return;
    try {
      if (started) await aomi.account.wallets.use(id, { thread });
      else walletPick = { ...walletPick, [wallet.family]: id };
      active = { ...active, [wallet.family]: id };
      note(`Wallet ${wallet.label} · ${signsWith(wallet)}`);
    } catch (error) {
      note(error instanceof Error ? error.message : String(error));
    }
  }

  /** The thread's wallet as the server has it. */
  async function loadWallet() {
    const history = await aomi.agent
      .thread(thread)
      .history()
      .catch(() => undefined);
    if (history) active = { ...active, ...history.activeWallet };
    tui.requestRender();
  }

  /** Show the thread so far: its turns, title and wallet. */
  async function loadThread() {
    turns.length = 0;
    started = false;
    active = {};
    tui.requestRender();
    const history = await aomi.agent
      .thread(thread)
      .history({ decode })
      .catch(() => undefined);
    if (!history?.turns.length) return;
    started = true;
    active = history.activeWallet;
    for (const turn of history.turns)
      turns.push({
        text: turn.text,
        steps: turn.steps,
        started: 0,
        ms: turn.seconds * 1000,
        reply: turn.replies.join("\n\n"),
        commits: [],
      });
    tui.requestRender();
  }

  void statusBar(aomi, bar).then((list) => {
    // Its requests wait for any sign-in the saved grant needed.
    signing = undefined;
    wallets = list;
    tui.requestRender();
  });
  loadGuard();
  if (resume) {
    void loadThread();
    void aomi.agent.threads
      .list({ limit: 50 })
      .then(({ threads }) => {
        title = threads.find((entry) => entry.id === thread)?.title || title;
        tui.requestRender();
      })
      .catch(() => undefined);
  }
  tui.start();
  await done;
}

/** Who signs and what is left, filled in once the screen is up; returns the account's wallets. */
async function statusBar(
  aomi: Aomi,
  bar: { who: string; credits: string },
): Promise<AomiAccountWallet[]> {
  const signer = aomi.wallet?.evm?.address ?? aomi.wallet?.svm?.address;
  if (signer) bar.who = `key ${short(signer)} (signs here)`;
  if (aomi.auth.mode === "guest") return [];
  const [wallets, credits] = await Promise.all([
    aomi.account.wallets.list().catch(() => []),
    aomi.account.credits.get().catch(() => null),
  ]);
  if (!signer) bar.who = "";
  if (credits) {
    // What the account can spend: this month's allowance left, then bought credits.
    const { used_microusd, limit_microusd } = credits.included;
    const left =
      Math.max(0, limit_microusd - used_microusd) + credits.balance_microusd;
    bar.credits = `${Math.trunc(left / 10_000).toLocaleString("en-US")} credits left`;
  }
  return wallets;
}

/** A device sign-in waiting for approval in the browser. */
function signInBox(
  prompt: { url: string; code: string },
  width: number,
): string[] {
  const size = Math.min(width, Math.max(48, visibleWidth(prompt.url) + 12));
  const inner = size - 4;
  const row = (text: string) =>
    `${paint.cyan("│")} ${truncateToWidth(text, inner, "…", true)} ${paint.cyan("│")}`;
  const titleText = "┌ Sign in to Aomi ";
  return [
    paint.cyan(
      `${titleText}${"─".repeat(Math.max(0, size - visibleWidth(titleText) - 1))}┐`,
    ),
    row(`${paint.dim("Open ")} ${prompt.url}`),
    row(`${paint.dim("Code ")} ${paint.bold(prompt.code)}`),
    row(""),
    row(
      `${paint.yellow("◐")} Waiting for approval   ${paint.cyan(paint.bold("o"))} Open in browser`,
    ),
    paint.cyan(`└${"─".repeat(size - 2)}┘`),
  ];
}

/** The commit waiting for you, with its keys. */
function approveBox(
  commit: CommitHandle,
  width: number,
  details: boolean,
): string[] {
  const inner = width - 4;
  const row = (text: string) =>
    `${paint.yellow("│")} ${truncateToWidth(text, inner, "…", true)} ${paint.yellow("│")}`;
  const label = commit.kind.endsWith("message") ? "message" : "transaction";
  const titleText = `┌ Approve ${label} `;
  const lines = [
    paint.yellow(
      `${titleText}${"─".repeat(Math.max(0, width - visibleWidth(titleText) - 1))}┐`,
    ),
    row(reviewSummary(commit.review)),
    row(
      `${paint.dim("Signs with")} ${short(commit.view.signer)} ${paint.dim("· Ask")}`,
    ),
  ];
  if (details)
    for (const line of reviewLines(commit.view, commit.review))
      lines.push(row(paint.dim(line)));
  lines.push(
    row(
      `${paint.cyan(paint.bold("a"))} Approve   ${paint.cyan(paint.bold("r"))} Reject   ${paint.cyan(paint.bold("o"))} Open in browser   ${paint.cyan(paint.bold("d"))} Details`,
    ),
    paint.yellow(`└${"─".repeat(width - 2)}┘`),
  );
  return lines;
}
