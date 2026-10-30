// Typechecked README blocks; kept in sync by readme-snippets.test.ts.
import { Aomi } from "@aomi-labs/client";

const aomi = new Aomi();
const thread = aomi.agent.thread();
const turn = thread.send("Introduce Aomi in one sentence.");
const { reply, commits } = await turn;
console.log(reply);
for (const commit of commits) commit.close();

import { oauth, wallet } from "@aomi-labs/client";
import { fileGrants } from "@aomi-labs/client/node";

const signedIn = new Aomi({
  auth: oauth({
    store: fileGrants("./.private/aomi-grants.json"),
    onCode: ({ url, code }) => console.log(`Open ${url}, code ${code}`),
  }),
});
await signedIn.auth.login();
console.log((await signedIn.agent.thread().send("Hello!")).reply);

import { viemSigner } from "@aomi-labs/client/viem";
import { createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const account = privateKeyToAccount(generatePrivateKey()); // disposable, unfunded
const bot = new Aomi({
  auth: wallet(account, { chainId: sepolia.id }),
  signer: {
    evm: viemSigner(
      createWalletClient({ account, chain: sepolia, transport: http() }),
    ),
  },
});
await bot.auth.login();

import { decode } from "@aomi-labs/client/trace";

const priced = thread.send("Use a tool to get the ETH price in USD.");
for await (const step of priced.steps({ decode })) {
  console.log(
    step.outcome,
    step.title,
    step.chips.map((chip) => chip.label),
  );
}
const priceResult = await priced;
console.log(priceResult.state, priceResult.reply);
for (const commit of priceResult.commits) commit.close();

async function reviewCommit(ref: string, accept: boolean) {
  const commit = await bot.commits.get(ref);
  try {
    const shown = commit.view;
    console.dir(commit.review, { depth: null });
    if (!accept) await commit.reject();
    else if (shown.state === "awaiting_approval") await commit.approve(shown);
    else await commit.sign();
  } finally {
    commit.close();
  }
}

async function prepareOperation(name: string, args: Record<string, unknown>) {
  const build = await bot.pipeline.build(name, args);
  console.log(build.digest, build.expiresAt);
  console.dir(build.balanceChanges);
  console.dir(build.approvals);
  return build;
}

const credits = await bot.account.credits.get();
const apps = await bot.account.apps.list();
const wallets = await bot.account.wallets.list();
console.log(credits.balance_microusd, apps, wallets);

// What a thread said so far, and switching the wallet it trades with.
const { messages, activeWallet } = await bot.agent.thread(thread.id).history();
console.log(messages.at(-1)?.text, activeWallet.evm);
if (wallets[0])
  await bot.account.wallets.use(wallets[0].id, { thread: thread.id });

import { AomiError, isAomiError } from "@aomi-labs/client";

try {
  await bot.account.credits.get();
} catch (error) {
  if (isAomiError(error)) console.error(error.code, error.status, error.hint);
  else throw error;
}
const exampleError = new AomiError("no_signer");
console.log(exampleError.hint);

import { AomiClient } from "@aomi-labs/client";

const raw = new AomiClient({
  baseUrl: "https://chat.aomi.dev",
  guest: false,
  getAccountBearer: async () => "your-server-held-session-token",
});
const page = await raw.agent.sessions.list({ limit: 5 });
console.log(page.sessions);
