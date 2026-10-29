import {
  buildApplication,
  buildCommand,
  buildRouteMap,
  proposeCompletions,
  run,
  type CommandContext,
  type RouteMap,
} from "@stricli/core";
import packageJson from "../package.json";
import * as account from "./commands/account";
import * as apps from "./commands/apps";
import { chat } from "./commands/chat";
import * as deploy from "./commands/deploy";
import { guard } from "./commands/guard";
import * as pipeline from "./commands/pipeline";
import * as settings from "./commands/settings";
import * as threads from "./commands/threads";
import * as tx from "./commands/tx";
import * as wallets from "./commands/wallets";
import { exitCodeOf, messageOf, parseChain } from "./context";

type Run = (flags: never, ...args: never[]) => Promise<void>;
type Flag = Record<string, unknown> & { brief: string };

// Flags, each scoped to the commands that use it. Hidden ones show in --help-all.
const text = (brief: string, more: object = {}): Flag => ({
  kind: "parsed",
  parse: String,
  brief,
  optional: true,
  placeholder: "value",
  ...more,
});
const yes = (brief: string, more: object = {}): Flag => ({
  kind: "boolean",
  brief,
  optional: true,
  ...more,
});
const int = (brief: string): Flag =>
  text(brief, { parse: Number, placeholder: "n" });

const json = { json: yes("Print JSON lines") };
/** How a command reaches Aomi, and who it is. */
const conn = {
  privateKey: text(
    "Sign in with this EVM key (SIWE) and sign with it; env AOMI_PRIVATE_KEY",
    { placeholder: "hex" },
  ),
  backendUrl: text("Aomi URL; env AOMI_BACKEND_URL", {
    hidden: true,
    placeholder: "url",
  }),
  apiKey: text("App key for a private app; env AOMI_API_KEY", {
    hidden: true,
    placeholder: "key",
  }),
};
/** What signs locally. */
const signing = {
  ...conn,
  solanaPrivateKey: text("Solana key that signs (base58 or JSON bytes)", {
    hidden: true,
    placeholder: "key",
  }),
  rpcUrl: text("RPC URL for local signing", {
    hidden: true,
    placeholder: "url",
  }),
  chain: text("Chain id", { parse: parseChain, placeholder: "id" }),
};
const deployFlags = {
  ...json,
  activationToken: text("Platform activation token; env AOMI_DEPLOY_TOKEN", {
    placeholder: "token",
  }),
  platform: text(
    "Deploy platform (default community); env AOMI_DEPLOY_PLATFORM",
    { placeholder: "name" },
  ),
  backendUrl: text("Manager URL (default https://api.aomi.dev)", {
    hidden: true,
    placeholder: "url",
  }),
};

const arg = (brief: string, placeholder: string, optional = false) => ({
  brief,
  placeholder,
  parse: String as (input: string) => unknown,
  optional,
});

/** One command. Errors print as one line and set the exit code. */
function command(
  brief: string,
  flags: Record<string, Flag>,
  args: ReturnType<typeof arg>[] | { rest: ReturnType<typeof arg> },
  action: Run,
  more: { aliases?: Record<string, string> } = {},
) {
  return buildCommand({
    docs: { brief },
    parameters: {
      flags,
      aliases: more.aliases,
      positional:
        "rest" in args
          ? { kind: "array", parameter: args.rest }
          : { kind: "tuple", parameters: args },
    },
    async func(this: CommandContext, parsed: object, ...rest: unknown[]) {
      try {
        await (action as (...input: unknown[]) => Promise<void>)(
          parsed,
          ...rest,
        );
      } catch (error) {
        process.stderr.write(`error: ${messageOf(error)}\n`);
        process.exitCode = exitCodeOf(error);
      }
    },
  } as never);
}

const routes = <R extends string>(
  brief: string,
  map: Record<R, ReturnType<typeof command> | RouteMap<CommandContext>>,
  more: {
    default?: NoInfer<R>;
    aliases?: Record<string, NoInfer<R>>;
    hidden?: NoInfer<R>[];
  } = {},
) =>
  buildRouteMap({
    routes: map,
    defaultCommand: more.default,
    aliases: more.aliases,
    docs: {
      brief,
      hideRoute: Object.fromEntries(
        (more.hidden ?? []).map((name) => [name, true]),
      ),
    },
  } as never) as RouteMap<CommandContext>;

const BRIEFS = {
  chat: "Ask once or continue a thread",
  threads: "List, open, rename, archive",
  login: "Sign in with one device code",
  logout: "Sign out on this machine",
  whoami: "Who you're signed in as",
  account: "Profile, connections, credits",
  wallets: "Agent wallets, local signer",
  tx: "Review, approve, sign, export",
  guard: "Spending limits for signing",
  apps: "Install apps, set credentials",
  pipeline: "Call app operations directly",
  deploy: "Ship your own app",
  model: "Pick the model",
  chain: "Pick the chain",
  keys: "Your own provider keys",
  secret: "Secrets the agent's tools can use",
  config: "Where the CLI points",
  completion: "Shell completion script",
};

const ALIASES: Record<string, keyof typeof BRIEFS> = {
  session: "threads",
  wallet: "wallets",
  app: "apps",
  byok: "keys",
};

const chatCommand = command(
  BRIEFS.chat,
  {
    prompt: text("Ask once, print the answer", { placeholder: "message" }),
    thread: text("Continue this thread", { placeholder: "id" }),
    new: yes("Start a new thread"),
    app: text("Route to this app (Direct)", { placeholder: "name" }),
    model: text("Model for this turn", { placeholder: "name" }),
    ...json,
    ...signing,
  },
  [arg("What to ask", "message", true)],
  chat,
  { aliases: { p: "prompt" } },
);

const login = command(
  BRIEFS.login,
  { backendUrl: conn.backendUrl },
  [],
  account.login,
);
const logout = command(
  BRIEFS.logout,
  { backendUrl: conn.backendUrl },
  [],
  account.logout,
);
const whoami = command(
  BRIEFS.whoami,
  { ...json, ...conn },
  [],
  account.whoami,
);

const ref = [arg("Commit ref", "ref")];
const signerShow = command("The local signer", json, [], wallets.signer);
const signerSet = command(
  "Keep a key to sign with",
  {
    ...json,
    solana: text("Solana key (base58 or JSON bytes)", { placeholder: "key" }),
    cluster: text("mainnet, devnet or testnet", { placeholder: "name" }),
  },
  [arg("EVM private key", "hex", true)],
  wallets.setSigner,
);

const root = routes(
  "the Aomi agent in your terminal",
  {
    chat: chatCommand,
    threads: routes(
      BRIEFS.threads,
      {
        list: command(
          "Your threads, newest first",
          { ...json, ...conn, limit: int("How many") },
          [],
          threads.list,
        ),
        open: command(
          "Continue a thread",
          {},
          [arg("Thread id", "id")],
          threads.open,
        ),
        new: command("Start a new thread", {}, [], threads.start),
        rename: command(
          "Rename a thread",
          { ...json, ...conn },
          [arg("Thread id", "id"), arg("New title", "title")],
          threads.rename,
        ),
        archive: command(
          "Archive a thread",
          { ...json, ...conn },
          [arg("Thread id", "id")],
          threads.archive,
        ),
      },
      { default: "list", aliases: { resume: "open" } },
    ),
    login,
    logout,
    whoami,
    account: routes(
      BRIEFS.account,
      {
        show: command(
          "Profile, logins, wallets and credits",
          { ...json, ...conn },
          [],
          account.show,
        ),
        connections: command(
          "Ways to sign in",
          { ...json, ...conn },
          [],
          account.connections,
        ),
        unlink: command(
          "Remove a way to sign in",
          { ...conn, yes: yes("Confirm") },
          [arg("Login id", "id")],
          account.unlink,
        ),
        credits: command(
          "Balance and recent activity",
          { ...json, ...conn, limit: int("Activity rows") },
          [],
          account.showCredits,
        ),
        fund: command(
          "Buy credits from --private-key's wallet",
          {
            ...json,
            ...conn,
            network: text("Treasury network, e.g. eip155:8453", {
              optional: false,
              placeholder: "caip2",
            }),
            idempotencyKey: text("Reuse it when retrying", {
              optional: false,
              placeholder: "key",
            }),
          },
          [{ ...arg("Whole credits, 100-100000", "credits"), parse: Number }],
          account.fund,
        ),
        statement: command(
          "Priced usage",
          {
            ...json,
            ...conn,
            limit: int("Page size"),
            cursor: text("Page cursor", { placeholder: "cursor" }),
          },
          [],
          account.statement,
        ),
        login,
        logout,
        whoami,
      },
      {
        default: "show",
        aliases: { links: "connections" },
        hidden: ["login", "logout", "whoami"],
      },
    ),
    wallets: routes(
      BRIEFS.wallets,
      {
        list: command(
          "The account's wallets, agent wallets first",
          { ...json, ...conn },
          [],
          wallets.list,
        ),
        balance: command(
          "An agent wallet's balances",
          { ...json, ...conn },
          [arg("Wallet id", "id")],
          wallets.balance,
        ),
        use: command(
          "Trade with this wallet in the current thread",
          { ...json, ...conn },
          [arg("Wallet id", "id")],
          wallets.use,
        ),
        signer: routes(
          "This machine's signing keys",
          {
            show: signerShow,
            set: signerSet,
            clear: command(
              "Forget the local keys",
              {},
              [],
              wallets.clearSigner,
            ),
          },
          { default: "show" },
        ),
        current: signerShow,
        set: signerSet,
      },
      { default: "list", hidden: ["current", "set"] },
    ),
    tx: routes(
      BRIEFS.tx,
      {
        list: command(
          "What the thread left to sign or approve",
          {
            ...json,
            ...conn,
            thread: text("Thread id", { placeholder: "id" }),
          },
          [],
          tx.list,
        ),
        review: command(
          "One commit: state, chain, signer, review",
          { ...json, ...conn },
          ref,
          tx.review,
        ),
        approve: command(
          "Approve a commit waiting for you",
          {
            ...json,
            ...conn,
            yes: yes("Approve without asking"),
            wait: yes("Follow it until it settles (--no-wait skips)", {
              default: true,
              optional: undefined,
            }),
          },
          ref,
          tx.approve,
        ),
        reject: command(
          "Reject a commit",
          { ...json, ...conn },
          ref,
          tx.reject,
        ),
        sign: command(
          "Sign a commit with the local signer",
          { ...json, ...signing },
          ref,
          tx.sign,
        ),
        export: command(
          "The exact reviewed commit, for an external signer",
          conn,
          ref,
          tx.exportCommit,
        ),
      },
      { default: "list", aliases: { show: "review" } },
    ),
    guard: command(
      BRIEFS.guard,
      {
        ...json,
        ...conn,
        account: yes("The account default"),
        thread: text("This thread", { placeholder: "id" }),
      },
      [arg("guarded_only, balanced or unrestricted", "mode", true)],
      guard,
    ),
    apps: routes(
      BRIEFS.apps,
      {
        list: command("Apps you can use", { ...json, ...conn }, [], apps.list),
        install: command(
          "Install an app",
          { ...json, ...conn },
          [arg("App name", "name")],
          apps.install,
        ),
        uninstall: command(
          "Uninstall an app",
          { ...json, ...conn },
          [arg("App name", "name")],
          apps.uninstall,
        ),
        use: command(
          "Route chat to an app (none: Auto)",
          {},
          [arg("App name", "name", true)],
          settings.setApp,
        ),
        credentials: routes(
          "An app's credentials",
          {
            list: command(
              "The app's credential slots",
              { ...json, ...conn },
              [arg("App name", "name")],
              apps.credentials,
            ),
            set: command(
              "Set one (value from stdin or a prompt)",
              { ...json, ...conn },
              [arg("App name", "name"), arg("Credential", "key")],
              apps.setCredential,
            ),
            remove: command(
              "Remove one",
              conn,
              [arg("App name", "name"), arg("Credential", "key")],
              apps.removeCredential,
            ),
          },
          { default: "list" },
        ),
      },
      { default: "list", aliases: { add: "install", remove: "uninstall" } },
    ),
    pipeline: routes(
      BRIEFS.pipeline,
      {
        ops: command(
          "Operations of an app or skill",
          {
            ...json,
            ...conn,
            app: text("App (default: default)", { placeholder: "name" }),
            skill: text("Skill", { placeholder: "name" }),
            filter: text("Names containing this", { placeholder: "text" }),
          },
          [],
          pipeline.operations,
        ),
        op: command(
          "Describe one operation",
          {
            ...conn,
            app: text("App", { placeholder: "name" }),
            skill: text("Skill", { placeholder: "name" }),
          },
          [arg("Operation", "name")],
          pipeline.operation,
        ),
        apps: command(
          "Apps with operations",
          {
            ...json,
            ...conn,
            filter: text("Names containing this", { placeholder: "text" }),
          },
          [],
          pipeline.apps,
        ),
        skills: command(
          "Skills",
          {
            ...json,
            ...conn,
            filter: text("Names containing this", { placeholder: "text" }),
          },
          [],
          pipeline.skills,
        ),
        skill: command(
          "One skill",
          { ...json, ...conn, instructions: yes("Print its SKILL.md") },
          [arg("Skill", "name")],
          pipeline.skill,
        ),
        invoke: command(
          "Run a read operation",
          {
            ...conn,
            app: text("App", { placeholder: "name" }),
            skill: text("Skill", { placeholder: "name" }),
            idempotencyKey: text("Reuse when retrying", { placeholder: "key" }),
          },
          [
            arg("Operation", "name"),
            arg("JSON arguments, a file, @file or -", "args", true),
          ],
          pipeline.invoke,
        ),
        build: command(
          "Stage and simulate an operation",
          {
            ...json,
            ...signing,
            app: text("App (default: default)", { placeholder: "name" }),
            commit: yes("Also make the commit to sign"),
            chainFamily: text("evm or svm when it can't be told", {
              hidden: true,
              placeholder: "family",
            }),
          },
          [
            arg("Operation", "name"),
            arg("JSON arguments, a file, @file or -", "args", true),
          ],
          pipeline.build,
        ),
      },
      { default: "ops", aliases: { operations: "ops", operation: "op" } },
    ),
    deploy: routes(
      BRIEFS.deploy,
      {
        run: command(
          "Deploy the current commit",
          {
            ...deployFlags,
            projectId: int("Project id; env AOMI_PROJECT_ID"),
            branch: text("Deploy this branch's tip", { placeholder: "branch" }),
            commit: text("Deploy this commit", { placeholder: "sha" }),
            preflight: yes("Preview the manifest only"),
          },
          [],
          deploy.deploy,
        ),
        status: command(
          "The deployment's state",
          {
            ...deployFlags,
            deploymentId: text("Deployment id", { placeholder: "id" }),
            watch: yes("Poll until it is ready or failed"),
          },
          [],
          deploy.status,
        ),
        activate: command(
          "Promote the deployment",
          {
            ...deployFlags,
            deploymentId: text("Deployment id", { placeholder: "id" }),
          },
          [],
          deploy.activate,
        ),
      },
      { default: "run", hidden: ["run"] },
    ),
    model: routes(
      BRIEFS.model,
      {
        current: command("The model in use", {}, [], settings.currentModel),
        list: command(
          "Models you can use",
          { ...json, ...conn },
          [],
          settings.models,
        ),
        set: command(
          "Use this model",
          {},
          [arg("Model", "name")],
          settings.setModel,
        ),
      },
      { default: "current" },
    ),
    chain: routes(
      BRIEFS.chain,
      {
        current: command("The chain in use", {}, [], settings.currentChain),
        list: command("Supported chains", json, [], settings.chains),
        set: command(
          "Use this chain",
          {},
          [{ ...arg("Chain id", "id"), parse: parseChain }],
          settings.setChain,
        ),
      },
      { default: "current" },
    ),
    keys: routes(
      BRIEFS.keys,
      {
        list: command(
          "Providers with a saved key",
          { ...json, ...conn },
          [],
          settings.keys,
        ),
        set: command(
          "Save a provider key (from stdin or a prompt)",
          conn,
          [arg("Provider, e.g. anthropic", "provider")],
          settings.setKey,
        ),
        remove: command(
          "Remove a provider key",
          conn,
          [arg("Provider", "provider")],
          settings.removeKey,
        ),
      },
      { default: "list" },
    ),
    secret: routes(
      BRIEFS.secret,
      {
        list: command(
          "Secret names",
          { ...json, ...conn },
          [],
          settings.secrets,
        ),
        add: command(
          "Add NAME=value secrets",
          conn,
          { rest: arg("NAME=value", "secret") },
          settings.addSecrets,
        ),
        clear: command("Remove every secret", conn, [], settings.clearSecrets),
      },
      { default: "list" },
    ),
    config: routes(
      BRIEFS.config,
      {
        current: command(
          "Backend, thread, model, app, chain",
          { ...json, backendUrl: conn.backendUrl },
          [],
          settings.config,
        ),
        "set-backend": command(
          "Point at another Aomi",
          {},
          [arg("URL", "url")],
          settings.setBackend,
        ),
      },
      { default: "current" },
    ),
    completion: command(
      BRIEFS.completion,
      {},
      [arg("bash or zsh", "shell", true)],
      completion,
    ),
  },
  { aliases: ALIASES },
);

export const app = buildApplication(root, {
  name: "aomi",
  scanner: { caseStyle: "allow-kebab-for-camel" },
  documentation: { disableAnsiColor: !process.stdout.isTTY },
  determineExitCode: exitCodeOf,
});

const GROUPS: [string, (keyof typeof BRIEFS)[]][] = [
  ["CHAT", ["chat", "threads"]],
  ["ACCOUNT", ["login", "logout", "whoami", "account"]],
  ["WALLETS & TRADES", ["wallets", "tx", "guard"]],
  ["APPS", ["apps", "pipeline", "deploy"]],
];
const SETTINGS: (keyof typeof BRIEFS)[] = [
  "model",
  "chain",
  "keys",
  "secret",
  "config",
  "completion",
];

/** `aomi --help`: the route table in groups, aliases in grey. */
export function rootHelp(color = Boolean(process.stdout.isTTY)): string {
  const [b, c, d] = color
    ? ["\u001b[1m", "\u001b[36m", "\u001b[2m"].map(
        (on) => (s: string) => `${on}${s}\u001b[0m`,
      )
    : [(s: string) => s, (s: string) => s, (s: string) => s];
  const alias = (name: string) =>
    Object.entries(ALIASES).find(([, target]) => target === name)?.[0];
  const lines = [
    `${b!(`aomi ${packageJson.version}`)}  the Aomi agent in your terminal`,
    "",
    b!("USAGE"),
    "  aomi                    Open the chat",
    '  aomi -p "<message>"     Ask once, print the answer',
    "  aomi <command> [flags]",
  ];
  for (const [group, names] of GROUPS) {
    lines.push("", b!(group));
    for (const name of names) {
      const row = `  ${c!(name.padEnd(10))} ${BRIEFS[name]}`;
      const grey = alias(name);
      lines.push(grey ? `${row.padEnd(44 + (color ? 9 : 0))}${d!(grey)}` : row);
    }
  }
  lines.push(
    "",
    b!("SETTINGS"),
    `  ${SETTINGS.map((name) => `${c!(name)}${alias(name) ? ` ${d!(alias(name)!)}` : ""}`).join("  ")}`,
    "",
    d!("aomi <command> --help for flags · grey names are aliases"),
  );
  return `${lines.join("\n")}\n`;
}

const SCRIPT = `# aomi completion: eval "$(aomi completion)"
_aomi() { COMPREPLY=($(aomi __complete "\${COMP_WORDS[@]:1:COMP_CWORD}")); }
complete -o default -F _aomi aomi
`;

async function completion(_flags: object, shell = "bash"): Promise<void> {
  process.stdout.write(
    shell === "zsh"
      ? `autoload -Uz bashcompinit && bashcompinit\n${SCRIPT}`
      : SCRIPT,
  );
}

/** `aomi __complete <words…>`, for the script above. Not parsed: words may look like flags. */
async function complete(words: string[]): Promise<void> {
  // A half-typed flag is not an error while completing.
  const proposals = await proposeCompletions(app, words.length ? words : [""], {
    process,
  }).catch(() => []);
  for (const proposal of proposals)
    process.stdout.write(`${proposal.completion}\n`);
}

/** Root flags that mean "chat": `aomi`, `aomi -p …`, `aomi --thread …`. */
function routed(argv: string[]): string[] {
  const first = argv[0];
  if (first === undefined) return ["chat"];
  if (
    first.startsWith("-") &&
    !["-h", "--help", "--help-all", "--helpAll", "-H"].includes(first)
  )
    return ["chat", ...argv];
  return argv;
}

/** Usage errors from the parser are 2; everything else keeps its code. */
export async function main(argv: string[]): Promise<number> {
  process.exitCode = undefined;
  if (argv[0] === "__complete") {
    await complete(argv.slice(1));
    return 0;
  }
  if (argv.length === 1 && ["-h", "--help"].includes(argv[0]!)) {
    process.stdout.write(rootHelp());
    return 0;
  }
  if (argv.length === 1 && ["-v", "--version"].includes(argv[0]!)) {
    process.stdout.write(`${packageJson.version}\n`);
    return 0;
  }
  await run(app, routed(argv), { process });
  const code = Number(process.exitCode ?? 0);
  return code < 0 ? 2 : code;
}
