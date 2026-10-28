import {
  CombinedAutocompleteProvider,
  Editor,
  matchesKey,
  ProcessTerminal,
  truncateToWidth,
  TuiMainScreen,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import { CHAIN_NAMES, Turn, type Aomi, type CommitHandle } from "@aomi-labs/client";
import { decode, type InterpretedToolStep } from "@aomi-labs/client/trace";
import packageJson from "../../package.json";
import type { ChatFlags } from "../commands/chat";
import { reviewLines, reviewSummary } from "../commands/tx";
import { connect, openUrl, turnOptions } from "../context";
import { loadState, updateState } from "../state";
import { GLYPHS, chipsOf, paint, statusOf } from "../trace";

type TurnView = {
  text?: string;
  note?: string;
  steps: InterpretedToolStep[];
  started: number;
  ms?: number;
  reply?: string;
  commits: CommitHandle[];
  error?: string;
};

const SLASH = [
  { name: "model", description: "Pick the model for this thread" },
  { name: "mode", description: "Auto or Direct routing" },
  { name: "new", description: "Start a new thread" },
  { name: "help", description: "Keys and commands" },
  { name: "exit", description: "Quit" },
];

const HELP = [
  "/model [name]          pick the model (no name: list them)",
  "/mode auto | direct <app>  route to every app, or one",
  "/new                   start a new thread",
  "esc stops a turn · ctrl+o expands steps · ctrl+c quits",
  "a r o d on an approval: approve, reject, open, details",
].join("\n");

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The chat screen: turns with their steps, approvals, the input and a status bar. */
export async function runTui(flags: ChatFlags): Promise<void> {
  const aomi = await connect(flags);
  let thread = flags.new ? crypto.randomUUID() : (flags.thread ?? loadState().thread);
  let title = "new thread";
  const turns: TurnView[] = [];
  let running: Turn | undefined;
  let expanded = false;
  let details = false;
  const bar = { who: "guest", credits: "" };

  const terminal = new ProcessTerminal();
  const tui = new TuiMainScreen(terminal);
  const editor = new Editor(tui, {
    borderColor: paint.dim,
    selectList: {
      selectedPrefix: paint.cyan,
      selectedText: paint.cyan,
      description: paint.dim,
      scrollInfo: paint.dim,
      noMatch: paint.dim,
    },
  });
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(SLASH, process.cwd()));

  const pending = () =>
    turns.at(-1)?.commits.find((commit) => commit.state === "awaiting_approval");

  const transcript: Component = {
    invalidate() {},
    render(width) {
      const lines = [paint.dim(`aomi ${packageJson.version} · thread "${title}"`)];
      turns.forEach((turn, index) => lines.push("", ...turnLines(turn, index === turns.length - 1)));
      const commit = pending();
      if (commit) lines.push("", ...approveBox(commit, Math.min(width, 60), details));
      return lines.flatMap((line) => wrapTextWithAnsi(line, width)).map((line) => truncateToWidth(line, width));
    },
  };

  function turnLines(turn: TurnView, last: boolean): string[] {
    if (turn.note) return turn.note.split("\n").map(paint.dim);
    const seconds = Math.round(((turn.ms ?? Date.now() - turn.started) as number) / 1000);
    const head = turn.ms === undefined
      ? `${paint.yellow("●")} ${paint.bold(`Working ${seconds}s`)}`
      : `${paint.green("●")} ${paint.bold(`Worked ${seconds}s`)}`;
    const lines = [`${paint.cyan(paint.bold("›"))} ${turn.text}`, ""];
    lines.push(`${head} ${paint.dim(`· ${turn.steps.length} steps`)}  ${paint.dim(`ctrl+o ${expanded ? "collapse" : "expand"}`)}`);
    if (expanded || last || turn.ms === undefined)
      for (const step of turn.steps) {
        const status = statusOf(step);
        const glyph = status === "success" ? paint.green(GLYPHS.success) : status === "waiting" ? paint.yellow(GLYPHS.waiting) : paint.red(GLYPHS.failed);
        lines.push(`  ${glyph} ${step.title.padEnd(22)} ${paint.dim(chipsOf(step))}`);
      }
    if (turn.reply) lines.push("", turn.reply);
    if (turn.error) lines.push("", paint.red(turn.error));
    for (const commit of turn.commits)
      if (commit.state !== "awaiting_approval" && !["confirmed", "failed", "rejected", "expired"].includes(commit.state))
        lines.push("", `${paint.yellow("Sign it")}  aomi tx sign ${commit.ref}`);
    return lines;
  }

  const status: Component = {
    invalidate() {},
    render(width) {
      const state = loadState();
      const left = [
        bar.who,
        state.chain ? (CHAIN_NAMES[state.chain] ?? `chain ${state.chain}`) : undefined,
        state.model ?? "default model",
        state.app ? `Direct ${state.app}` : "Auto",
        bar.credits,
      ].filter(Boolean).join(" · ");
      const right = `${running ? "esc stop" : "ctrl+c quit"} · /help`;
      const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
      return [truncateToWidth(paint.dim(`${left}${" ".repeat(gap)}${right}`), width)];
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
  const exit = () => {
    for (const turn of turns) for (const commit of turn.commits) commit.close();
    tui.stop();
    quit();
  };

  tui.addInputListener((data) => {
    if (matchesKey(data, "ctrl+c")) return exit(), { consume: true };
    if (matchesKey(data, "escape") && running) return void running.interrupt(), { consume: true };
    if (matchesKey(data, "ctrl+o")) {
      expanded = !expanded;
      tui.requestRender();
      return { consume: true };
    }
    const commit = pending();
    if (!commit || editor.getText() || !/^[arod]$/.test(data)) return undefined;
    if (data === "o" && commit.signUrl) openUrl(commit.signUrl);
    if (data === "d") details = !details;
    if (data === "a" || data === "r") void decide(commit, data === "a");
    tui.requestRender();
    return { consume: true };
  });

  async function decide(commit: CommitHandle, approve: boolean) {
    try {
      if (!approve) {
        await commit.reject();
        return note("Rejected");
      }
      await commit.approve(commit.view);
      note("Approved · signing…");
      const last = await commit.settled();
      note(last.signature ? `Signed · ${last.signature}` : `Confirmed · ${last.transaction_url ?? last.transaction_id ?? ""}`);
    } catch (error) {
      note(error instanceof Error ? error.message : String(error));
    }
  }

  async function send(text: string) {
    const view: TurnView = { text, steps: [], started: Date.now(), commits: [] };
    turns.push(view);
    const ticker = setInterval(() => tui.requestRender(), 1000);
    try {
      const options = turnOptions(aomi, loadState(), { thread, app: flags.app, model: flags.model });
      thread = options.sessionId;
      running = new Turn(aomi.agent.run(text, options), (ref) => aomi.commits.get(ref));
      for await (const step of running.steps({ decode })) {
        view.steps.push(step);
        tui.requestRender();
      }
      const result = await running;
      view.reply = result.reply;
      view.commits = result.commits;
      for (const commit of result.commits) commit.subscribe(() => tui.requestRender());
      title = result.title || title;
      updateState({ thread: result.threadId });
    } catch (error) {
      view.error = error instanceof Error ? error.message : String(error);
    } finally {
      clearInterval(ticker);
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
    if (name === "new") {
      thread = crypto.randomUUID();
      title = "new thread";
      turns.length = 0;
      return note("New thread");
    }
    if (name === "model") {
      if (arg) return updateState({ model: arg }), note(`Model ${arg}`);
      const models = await aomi.raw.getModels(thread ?? crypto.randomUUID()).catch(() => []);
      return note(models.join("\n") || "No models listed");
    }
    if (name === "mode") {
      const [mode, app] = rest;
      if (mode === "auto") return updateState({ app: undefined }), note("Auto");
      if (mode === "direct" && app) return updateState({ app }), note(`Direct · ${app}`);
      return note("/mode auto | /mode direct <app>");
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

  void statusBar(aomi, bar).then(() => tui.requestRender());
  tui.start();
  await done;
}

/** Who signs and what is left, filled in once the screen is up. */
async function statusBar(aomi: Aomi, bar: { who: string; credits: string }) {
  const signer = aomi.wallet?.evm?.address ?? aomi.wallet?.svm?.address;
  if (signer) bar.who = short(signer);
  if (aomi.auth.mode === "guest") return;
  const [wallets, credits] = await Promise.all([
    aomi.account.wallets.list().catch(() => []),
    aomi.account.credits.get().catch(() => null),
  ]);
  const agent = wallets.find((wallet) => wallet.kind === "agent");
  if (!signer && agent) bar.who = agent.label;
  if (credits) bar.credits = `${(credits.balance_microusd / 10_000).toLocaleString("en-US", { maximumFractionDigits: 2 })} credits`;
}

/** The commit waiting for you, with its keys. */
function approveBox(commit: CommitHandle, width: number, details: boolean): string[] {
  const inner = width - 4;
  const row = (text: string) =>
    `${paint.yellow("│")} ${truncateToWidth(text, inner, "…", true)} ${paint.yellow("│")}`;
  const label = commit.kind.endsWith("message") ? "message" : "transaction";
  const titleText = `┌ Approve ${label} `;
  const lines = [
    paint.yellow(`${titleText}${"─".repeat(Math.max(0, width - visibleWidth(titleText) - 1))}┐`),
    row(reviewSummary(commit.review)),
    row(`${paint.dim("Signs with")} ${short(commit.view.signer)} ${paint.dim("· Ask")}`),
  ];
  if (details) for (const line of reviewLines(commit.view, commit.review)) lines.push(row(paint.dim(line)));
  lines.push(
    row(`${paint.cyan(paint.bold("a"))} Approve   ${paint.cyan(paint.bold("r"))} Reject   ${paint.cyan(paint.bold("o"))} Open in browser   ${paint.cyan(paint.bold("d"))} Details`),
    paint.yellow(`└${"─".repeat(width - 2)}┘`),
  );
  return lines;
}
