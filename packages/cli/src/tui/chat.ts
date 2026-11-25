import {
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
  CommitStaleError,
  isAgentSlug,
  isTerminalCommit,
  type Aomi,
  type AomiAccountWallet,
  type AomiActiveWallet,
  type AomiPackage,
  type CommitHandle,
  type CommitRefView,
  type MentionItem,
  type TransactionSafetyMode,
} from "@aomi-labs/client";
import { decode, type InterpretedToolStep } from "@aomi-labs/client/trace";
import { MentionAutocomplete, mentionCatalog, walletGroups } from "./mentions";
import packageJson from "../../package.json";
import type { ChatFlags } from "../commands/chat";
import { guardMode } from "../commands/guard";
import * as packages from "../commands/packages";
import { act } from "../commands/tx";
import { signIn } from "../commands/account";
import { signsWith } from "../commands/wallets";
import {
  agentsOf,
  baseUrlOf,
  CliError,
  connect,
  messageOf,
  openUrl,
  ownerOf,
  rpcReady,
  turnOptions,
  type ShowCode,
} from "../context";
import { Card } from "../review";
import { loadState, updateState } from "../state";
import {
  GLYPHS,
  chipsOf,
  paint,
  plain,
  plainText,
  statusOf,
  titleOf,
} from "../trace";

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
  turn.markdown ??= new Markdown(plainText(turn.reply ?? ""), 0, 0, MARKDOWN);
  return turn.markdown.render(width);
}

const SLASH = [
  { name: "model", description: "Pick the model for this thread" },
  { name: "wallet", description: "Pick the wallet this thread trades with" },
  { name: "agent", description: "Pin an agent, or go back to Auto" },
  { name: "library", description: "Packages: on, off, add, remove, show" },
  { name: "threads", description: "Continue another thread" },
  { name: "guard", description: "Strict, Balanced or Yolo for this thread" },
  { name: "new", description: "Start a new thread" },
  { name: "rpc", description: "The RPC that sends what you sign here" },
  { name: "login", description: "Sign in with a device code" },
  { name: "help", description: "Keys and commands" },
  { name: "exit", description: "Quit" },
];

const HELP = [
  "/model [name | auto]   pick the model",
  "/wallet                the wallet this thread trades with, and how it signs",
  "/agent [name | auto]   pin an agent, publisher/name, for this run",
  "/library [search]      packages: turn on or off, show, remove",
  "/library add <code>    add a private package",
  "/threads               continue another thread",
  "/guard [strict | balanced | yolo]  how guards gate this thread's actions",
  "/rpc <url>             the RPC that sends what you sign here",
  "/new                   start a new thread",
  "/login                 sign in with a device code",
  "esc stops a turn · ctrl+o expands steps · ctrl+c quits",
  "a s r o on a waiting transaction: approve, sign, reject, open",
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
  const bar = { who: aomi.auth.mode === "guest" ? "guest" : "", credits: "" };
  let wallets: AomiAccountWallet[] = [];
  /** The thread's wallet per family, once the server reports it. */
  let active: AomiActiveWallet = {};
  /** A wallet picked before the thread's first turn, sent with that turn. */
  let walletPick: AomiActiveWallet | undefined;
  /** Whether the thread exists on the server (it has history). */
  let started = false;
  let revision = 0;
  let commandRunning = false;
  let loadingThread = false;
  let guard: TransactionSafetyMode | undefined;
  const loadGuard = () => {
    const own = revision;
    return aomi.auth.mode === "guest"
      ? undefined
      : void aomi.account.guard
          .get({ thread })
          .then((policy) => {
            if (own !== revision || closing.signal.aborted) return;
            guard = policy.mode;
            tui.requestRender();
          })
          .catch(() => undefined);
  };

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

  /** A list has the keys. */
  let picking = false;
  /** A list above the input; enter picks, esc leaves things as they are. */
  function pick(
    items: SelectItem[],
    current: string,
    chosen: (value: string) => void,
  ) {
    const list = new SelectList(
      items.map((item) => ({
        ...item,
        label: plain(item.label),
        ...(item.description && { description: plain(item.description) }),
      })),
      10,
      listTheme,
    );
    list.setSelectedIndex(
      Math.max(
        0,
        items.findIndex((item) => item.value === current),
      ),
    );
    picking = true;
    const close = () => {
      picking = false;
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
  /** What "@" can tag; filled in once the screen is up. */
  let catalog: MentionItem[] = [];
  const loadMentions = () => {
    const own = revision;
    void agentsOf(flags, aomi)
      .then((agents) => mentionCatalog(aomi, thread, agents))
      .then((items) => {
        if (own === revision && !closing.signal.aborted) catalog = items;
      });
  };
  const mentions = new MentionAutocomplete(SLASH, () => catalog);
  editor.setAutocompleteProvider(mentions);

  /** Commits being approved, signed or rejected: one decision at a time. */
  const deciding = new Set<string>();
  /** The batch member that waits for your approval or signature. */
  const pending = () =>
    turns
      .flatMap((turn) => turn.commits)
      .map((commit) => commit.next)
      .find(
        (commit) =>
          !deciding.has(commit.ref) &&
          (commit.state === "awaiting_approval" ||
            (commit.state === "needs_signature" &&
              commit.view.action !== null)),
      );
  /** The card as last drawn: keys decide that version, not a newer one. */
  let drawn: { commit: CommitHandle; card: Card } | undefined;

  const transcript: Component = {
    invalidate() {},
    render(width) {
      const lines = [
        paint.dim(`aomi ${packageJson.version} · thread "${plain(title)}"`),
      ];
      turns.forEach((turn, index) =>
        lines.push("", ...turnLines(turn, index === turns.length - 1, width)),
      );
      const commit = pending();
      drawn = commit && { commit, card: new Card(commit.view, commit.review) };
      if (drawn)
        lines.push(
          "",
          ...commitBox(drawn.card, commit!.canSign(), Math.min(width, 76)),
        );
      if (signing) lines.push("", ...signInBox(signing, width));
      lines.push("");
      return lines
        .flatMap((line) => wrapTextWithAnsi(line, width))
        .map((line) => truncateToWidth(line, width));
    },
  };

  function turnLines(turn: TurnView, last: boolean, width: number): string[] {
    if (turn.note) return plainText(turn.note).split("\n").map(paint.dim);
    const text = plainText(turn.text ?? "");
    if (turn.past)
      return [
        ...(text ? [`${paint.cyan(paint.bold("›"))} ${text}`, ""] : []),
        ...(turn.reply ? replyLines(turn, width) : []),
      ];
    const seconds = Math.round(
      ((turn.ms ?? Date.now() - turn.started) as number) / 1000,
    );
    const head =
      turn.ms === undefined
        ? `${paint.yellow("●")} ${paint.bold(`Working ${seconds}s`)}`
        : `${paint.green("●")} ${paint.bold(`Worked ${seconds}s`)}`;
    const lines = [`${paint.cyan(paint.bold("›"))} ${text}`, ""];
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
          `  ${glyph} ${titleOf(step).padEnd(22)} ${paint.dim(chipsOf(step))}`,
        );
      }
    if (turn.reply) lines.push("", ...replyLines(turn, width));
    if (turn.error) lines.push("", paint.red(turn.error));
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
          : `${plain(wallet.label)} (${signsWith(wallet)})`,
        chain ? (CHAIN_NAMES[chain] ?? `chain ${chain}`) : undefined,
        flags.agent,
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
    revision++;
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
    if (!drawn || picking || editor.getText() || !/^[asro]$/.test(key))
      return undefined;
    const { commit, card } = drawn;
    const approves = card.view.state === "awaiting_approval";
    const action = !card.whole
      ? undefined
      : key === "r"
        ? "reject"
        : key === "a" && approves
          ? "approve"
          : key === "s" && !approves && commit.canSign()
            ? "sign"
            : undefined;
    // These keys also start a message, so a decision takes a second, explicit key.
    if (action)
      pick(
        [
          { value: "no", label: "Cancel" },
          {
            value: "yes",
            label: `${{ approve: "Approve", sign: "Sign", reject: "Reject" }[action]}${card.scope}`,
            description: `with ${short(card.view.signer)}`,
          },
        ],
        "no",
        (answer) =>
          void (answer === "yes" && decide(commit, card.view, action)),
      );
    else if (key === "o" && commit.signUrl) {
      openUrl(commit.signUrl);
      if (!approves) void decide(commit, card.view, "elsewhere");
    } else return undefined;
    tui.requestRender();
    return { consume: true };
  });

  /** Batches whose outcome a turn's last line already follows. */
  const following = new Set<CommitHandle>();

  /** Act on `commit` as `shown`, its progress on its turn's last line. */
  async function decide(
    commit: CommitHandle,
    shown: CommitRefView,
    how: "approve" | "sign" | "reject" | "elsewhere",
  ) {
    const own = revision;
    const source = thread;
    const holds = (entry: CommitHandle) =>
      entry.batch.some((member) => member.commit_id === commit.ref);
    const turn = turns.findLast((entry) => entry.commits.some(holds));
    const leader = turn?.commits.find(holds);
    if (!turn || !leader || deciding.has(commit.ref)) return;
    if (how !== "elsewhere") deciding.add(commit.ref);
    const follows = following.has(leader);
    const show = (line: string) => {
      turn.decision = line;
      tui.requestRender();
    };
    try {
      if (how === "reject") {
        await act(aomi, shown, how);
        return show(paint.dim("✗ Rejected"));
      }
      // The agent answers once it settles; count what it has said so far.
      const said = follows
        ? undefined
        : aomi.agent
            .thread(thread)
            .history()
            .then((history) => history.messages.length)
            .catch(() => undefined);
      if (how === "approve") {
        show(paint.yellow("◐ Approving…"));
        await act(aomi, shown, how);
      }
      if (how !== "elsewhere") show(paint.yellow("◐ Signing and sending…"));
      if (how === "sign") {
        await rpcReady(aomi, flags, shown);
        if (!isTerminalCommit(await act(aomi, shown, how)))
          show(paint.yellow("◐ Submitted; confirming…"));
      }
      if (follows) return;
      following.add(leader);
      const last = await leader.settled({ signal: closing.signal });
      show(
        paint.green(
          last.signature
            ? `✓ Signed · ${plain(last.signature)}`
            : `✓ Confirmed · ${plain(last.transaction_url ?? last.transaction_id ?? "")}`,
        ),
      );
      if (own === revision) void followUp(await said, source, own);
    } catch (error) {
      deciding.delete(commit.ref);
      if (!follows) following.delete(leader);
      if (error instanceof CommitStaleError) {
        await leader.refresh().catch(() => undefined);
        return show(paint.yellow("It changed; review it again"));
      }
      show(paint.red(messageOf(error)));
    }
  }

  /** The agent's answer to a settled commit: it continues the thread on its own. */
  async function followUp(
    said: number | undefined,
    source: string,
    own: number,
  ) {
    if (said === undefined) return;
    for (
      let attempt = 0;
      attempt < 45 && own === revision && !closing.signal.aborted;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const history = await aomi.agent
        .thread(source)
        .history()
        .catch(() => undefined);
      if (own !== revision || closing.signal.aborted) return;
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
        agent: flags.agent,
        model: flags.model,
        chain: flags.chain,
        walletPick: started ? undefined : walletPick,
      });
      thread = options.sessionId;
      // Like the composer, mentions only steer Auto.
      const hinted = mentions.hint(text);
      running = aomi.agent
        .thread(thread)
        .send(flags.agent ? text : hinted, options);
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
      view.error = messageOf(error);
    } finally {
      clearInterval(ticker);
      signing = undefined;
      view.ms = Date.now() - view.started;
      running = undefined;
      tui.requestRender();
    }
  }

  async function slash([name, ...rest]: string[]) {
    const arg = rest.join(" ");
    if (name === "exit") return exit();
    if (running && name !== "help") return note("Still working; esc stops it");
    if (name === "help") return note(HELP);
    if (name === "login") {
      if (aomi.auth.mode !== "guest") return note("Already signed in");
      try {
        await signIn(baseUrlOf(flags), showCode);
      } catch (error) {
        signing = undefined;
        return note(messageOf(error));
      }
      signing = undefined;
      aomi = await connect(flags, showCode);
      // The guest's threads stay with the guest.
      resetThread();
      thread = crypto.randomUUID();
      title = "new thread";
      turns.length = 0;
      started = false;
      active = {};
      bar.who = "";
      loadGuard();
      loadMentions();
      void statusBar(aomi, bar).then((list) => {
        wallets = list;
        tui.requestRender();
      });
      return note("Signed in");
    }
    if (name === "new") {
      resetThread();
      thread = crypto.randomUUID();
      title = "new thread";
      turns.length = 0;
      started = false;
      active = {};
      loadGuard();
      loadMentions();
      return note("New thread");
    }
    if (name === "library") return library(arg);
    if (name === "agent") {
      const choose = (agent: string) => {
        flags.agent = agent === "auto" ? undefined : agent;
        note(`Agent ${flags.agent ?? "Auto"}`);
      };
      if (arg)
        return arg === "auto" || isAgentSlug(arg)
          ? choose(arg)
          : note("/agent publisher/name, or /agent auto");
      const cards = await agentsOf(flags, aomi);
      return pick(
        [
          { value: "auto", label: "Auto", description: "Aomi picks" },
          ...cards.map((agent) => ({
            value: agent.agent,
            label: agent.display_name,
            description: agent.agent,
          })),
        ],
        flags.agent ?? "auto",
        choose,
      );
    }
    if (name === "rpc") {
      if (!arg || !drawn)
        return note("/rpc <url>, while a card waits to be signed");
      const { view } = drawn.card;
      await rpcReady(aomi, { ...flags, rpcUrl: arg }, view);
      // The saved RPC takes over.
      flags.rpcUrl = undefined;
      return note(`RPC saved for chain ${view.chain_ref}`);
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
          if (running) return note("Still working; esc stops it");
          resetThread();
          thread = id;
          title = threads.find((entry) => entry.id === id)?.title || title;
          updateState({ thread: id, owner: ownerOf(aomi) });
          void loadThread();
          loadGuard();
          loadMentions();
        },
      );
    }
    if (name === "wallet") {
      if (aomi.auth.mode === "guest")
        return note("Sign in for wallets: /login");
      if (!wallets.length) return note("No wallets yet");
      const groups = walletGroups(wallets);
      const current = groups.find((own) =>
        own.some((entry) => entry.id === (active.evm ?? active.svm)),
      );
      return pick(
        groups.map((own) => ({
          value: own[0]!.id,
          label: own[0]!.label,
          description: `${own.map((entry) => entry.family.toUpperCase()).join(" + ")} · ${signsWith(own[0]!)} · ${own.map((entry) => short(entry.address)).join(" · ")}`,
        })),
        current?.[0]!.id ?? "",
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
          note(messageOf(error));
        }
      };
      // Yolo runs flagged actions too, so it asks first, as on the web.
      const choose = (mode: TransactionSafetyMode) =>
        mode === "yolo"
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

  /** `/library`: the thread's packages, as the Portal's Library has them. */
  async function library(arg: string) {
    if (aomi.auth.mode === "guest")
      return note("Sign in for your packages: /login");
    const store = aomi.account.packages;
    const own = { threadId: started ? thread : undefined };
    const change = async (done: string, act: () => Promise<unknown>) => {
      try {
        await act();
        loadMentions();
        note(done);
      } catch (error) {
        note(messageOf(error));
      }
    };
    const ask = (label: string, done: string, act: () => Promise<unknown>) =>
      pick(
        [
          { value: "no", label: "Cancel" },
          { value: "yes", label },
        ],
        "no",
        (answer) => void (answer === "yes" && change(done, act)),
      );
    // Turning on shows what the package may do first, as everywhere.
    const turnOn = (row: AomiPackage) => {
      note(packages.notice(row).join("\n"));
      ask(`Turn on ${row.id}`, `${row.id} is on`, () =>
        store.setChoice(row.package_id, true, own),
      );
    };
    const [verb, code] = arg.split(/\s+/);
    if (verb === "add" && code) {
      const row = await store.activate(code);
      loadMentions();
      note(`${row.id} is added${row.enabled ? " and on" : ", but off"}`);
      return row.enabled ? undefined : turnOn(row);
    }
    const rows = (await store.list(own)).packages.filter((row) =>
      packages.keeps(row, { search: arg }),
    );
    if (!rows.length) return note("No packages found");
    pick(
      rows.map((row) => ({
        value: row.id,
        label: plain(row.display_name),
        description: `${packages.packageState(row)} · ${row.verified ? "verified" : "unverified"} · ${row.chains.join(", ") || "any chain"}`,
      })),
      "",
      (id) => {
        const row = rows.find((entry) => entry.id === id)!;
        const acts: Record<string, () => void> = {
          Show: () => note(packages.packageLines(row).join("\n")),
          ...(row.enabled
            ? !row.agent_listed && {
                "Turn off": () =>
                  void change(`${row.id} is off`, () =>
                    store.setChoice(row.package_id, false, own),
                  ),
              }
            : row.available && { "Turn on": () => turnOn(row) }),
          ...(row.removable && {
            Remove: () => {
              note(packages.removal(row));
              ask(`Remove ${row.id}`, `${row.id} is removed`, () =>
                store.remove(row.package_id),
              );
            },
          }),
        };
        pick(
          Object.keys(acts).map((label) => ({ value: label, label })),
          "",
          (label) => acts[label]!(),
        );
      },
    );
  }

  editor.onSubmit = (raw) => {
    const text = raw.trim();
    if (!text) return;
    const command = text.startsWith("/") && text.slice(1).trim().split(/\s+/);
    // A code or an RPC's key stays out of recall.
    if (!command || !/^(library add|rpc)\b/u.test(command.join(" ")))
      editor.addToHistory?.(text);
    if (command) {
      if (commandRunning) return note("A command is still working");
      commandRunning = true;
      void slash(command)
        .catch((error: unknown) => note(messageOf(error)))
        .finally(() => {
          commandRunning = false;
        });
    } else if (loadingThread || commandRunning || running)
      note("Still working; esc stops it");
    else void send(text);
  };

  function resetThread() {
    revision++;
    loadingThread = false;
    for (const turn of turns) for (const commit of turn.commits) commit.close();
    walletPick = undefined;
    guard = undefined;
    catalog = [];
  }

  /** Trade with the wallet `id` belongs to: each of its keys for its family. */
  async function useWallet(id: string) {
    const own = walletGroups(wallets).find((group) =>
      group.some((entry) => entry.id === id),
    );
    if (!own) return;
    try {
      for (const wallet of own) {
        if (started) await aomi.account.wallets.use(wallet.id, { thread });
        else walletPick = { ...walletPick, [wallet.family]: wallet.id };
        active = { ...active, [wallet.family]: wallet.id };
      }
      note(`Wallet ${own[0]!.label} · ${signsWith(own[0]!)}`);
    } catch (error) {
      note(messageOf(error));
    }
  }

  /** The thread's wallet as the server has it. */
  async function loadWallet() {
    const own = revision;
    const history = await aomi.agent
      .thread(thread)
      .history()
      .catch(() => undefined);
    if (own !== revision || closing.signal.aborted) return;
    if (history) active = { ...active, ...history.activeWallet };
    tui.requestRender();
  }

  /** Show the thread so far: its turns, title and wallet. */
  async function loadThread() {
    const own = revision;
    loadingThread = true;
    turns.length = 0;
    started = false;
    active = {};
    tui.requestRender();
    const history = await aomi.agent
      .thread(thread)
      .history({ decode })
      .catch(() => undefined);
    if (own !== revision || closing.signal.aborted) return;
    loadingThread = false;
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
  loadMentions();
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
    row(`${paint.dim("Open ")} ${plain(prompt.url)}`),
    row(`${paint.dim("Code ")} ${paint.bold(plain(prompt.code))}`),
    row(""),
    row(
      `${paint.yellow("◐")} Waiting for approval   ${paint.cyan(paint.bold("o"))} Open in browser`,
    ),
    paint.cyan(`└${"─".repeat(size - 2)}┘`),
  ];
}

/** The commit waiting for you: what it does, what checks it, and its keys. */
function commitBox(card: Card, local: boolean, width: number): string[] {
  const { view, guard } = card;
  const inner = width - 4;
  const rows = (text: string) =>
    wrapTextWithAnsi(text, inner).map(
      (line) =>
        `${paint.yellow("│")} ${truncateToWidth(line, inner, "…", true)} ${paint.yellow("│")}`,
    );
  const approves = view.state === "awaiting_approval";
  const titleText = `┌ ${approves ? "Approve" : "Sign"}${card.scope || " this"} `;
  const color = guard.startsWith("Covered")
    ? paint.green
    : /^(Blocked|Not cleared)/.test(guard)
      ? paint.red
      : paint.yellow;
  const key = (letter: string, label: string) =>
    `${paint.cyan(paint.bold(letter))} ${label}`;
  return [
    paint.yellow(
      `${titleText}${"─".repeat(Math.max(0, width - visibleWidth(titleText) - 1))}┐`,
    ),
    ...card.lines.flatMap((line) =>
      rows(line.startsWith("! ") ? paint.yellow(line) : line),
    ),
    ...rows(color(guard)),
    ...rows(
      [
        ...(!card.whole
          ? []
          : approves
            ? [key("a", "Approve"), key("r", "Reject")]
            : [...(local ? [key("s", "Sign")] : []), key("r", "Reject")]),
        key("o", "Open sign page"),
      ].join("   "),
    ),
    paint.yellow(`└${"─".repeat(width - 2)}┘`),
  ];
}
