import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import {
  Aomi,
  type Action,
  type AgentRun,
  type MessageEvent,
  type Wallets,
} from "@aomi-labs/client";
import {
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isHex,
  type Hex,
  type SignTypedDataParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const terminal = createInterface({ input: stdin, output: stdout });
const baseUrl = process.env.AOMI_BASE_URL?.trim() || "http://localhost:3000";
const wallet = createViemWalletFromEnvironment();
const aomi = new Aomi({ baseUrl, wallet });
const printedMessages = new Set<string>();
const handledActions = new Set<string>();

let activeRun: AgentRun | undefined;
let sessionId: string = crypto.randomUUID();

console.log("Aomi headless client");
console.log(`API: ${baseUrl}`);
console.log(
  wallet?.evm
    ? `Mode: guest session + Viem wallet ${wallet.evm.address} on chain ${readChainId(wallet)}`
    : "Mode: guest session (no wallet)",
);
console.log("Type a message, or /exit to quit.\n");

process.once("SIGINT", () => {
  void activeRun?.interrupt().catch(() => undefined);
  terminal.close();
});

try {
  while (true) {
    const prompt = (await terminal.question("you> ")).trim();
    if (prompt === "/exit") break;
    if (!prompt) continue;

    activeRun = aomi.agent.run(prompt, { sessionId });
    activeRun.on("action", (action) => {
      console.log(`\n[action] ${describeAction(action)} (${action.state})`);
      if (action.state !== "pending" || handledActions.has(action.id)) return;
      handledActions.add(action.id);
      void reviewAction(activeRun!, action);
    });

    try {
      const result = await activeRun.result();
      sessionId = result.sessionId;
      printNewAgentMessages(result.messages);
    } catch (error) {
      console.error(`\n[error] ${errorMessage(error)}`);
    } finally {
      activeRun = undefined;
      console.log();
    }
  }
} finally {
  terminal.close();
}

async function reviewAction(run: AgentRun, action: Action) {
  if (!run.session.actions.canExecute(action.id)) {
    console.log("[wallet] the configured wallet cannot execute this Action");
    await run.reject(action.id, "No compatible wallet is connected");
    return;
  }

  const approval = (await terminal.question("Approve this Action? [y/N] "))
    .trim()
    .toLowerCase();
  if (approval !== "y" && approval !== "yes") {
    await run.reject(action.id, "Rejected in the partner terminal");
    console.log("[wallet] rejected");
    return;
  }

  try {
    const resolved = await run.session.actions.execute(action.id);
    console.log(`[wallet] ${resolved.state}`);
  } catch (error) {
    console.error(`[wallet] failed: ${errorMessage(error)}`);
  }
}

function createViemWalletFromEnvironment(): Wallets | undefined {
  const rawPrivateKey = process.env.AOMI_PRIVATE_KEY?.trim();
  const rpcUrl = process.env.EVM_RPC_URL?.trim();
  const rawChainId = process.env.EVM_CHAIN_ID?.trim();

  if (!rawPrivateKey && !rpcUrl && !rawChainId) return undefined;
  if (!rawPrivateKey || !rpcUrl || !rawChainId) {
    throw new Error(
      "AOMI_PRIVATE_KEY, EVM_RPC_URL, and EVM_CHAIN_ID must be set together",
    );
  }
  if (!isHex(rawPrivateKey) || rawPrivateKey.length !== 66) {
    throw new Error("AOMI_PRIVATE_KEY must be a 32-byte 0x-prefixed hex value");
  }

  const chainId = Number(rawChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("EVM_CHAIN_ID must be a positive integer");
  }

  const account = privateKeyToAccount(rawPrivateKey);
  const chain = defineChain({
    id: chainId,
    name: `Configured chain ${chainId}`,
    nativeCurrency: { name: "Native token", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const viem = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  return {
    evm: {
      address: account.address,
      chainId,
      sendTransaction: async ({
        chainId: requestedChainId,
        to,
        data,
        value,
      }) => {
        if (requestedChainId !== chainId) {
          throw new Error(
            `Wallet is configured for chain ${chainId}, not ${requestedChainId}`,
          );
        }
        return viem.sendTransaction({
          account,
          chain,
          to: getAddress(to),
          data: data as Hex | undefined,
          value: BigInt(value ?? "0"),
        });
      },
      signMessage: ({ message }) =>
        viem.signMessage({ account, message: { raw: message as Hex } }),
      signTypedData: ({ typedData }) =>
        account.signTypedData(typedData as SignTypedDataParameters),
    },
  };
}

function printNewAgentMessages(messages: readonly MessageEvent[]) {
  for (const message of messages) {
    if (message.sender !== "agent" || printedMessages.has(message.event_id)) {
      continue;
    }
    printedMessages.add(message.event_id);
    console.log(`\naomi> ${message.content}`);
  }
}

function describeAction(action: Action): string {
  switch (action.request.type) {
    case "execute_evm":
      return `EVM transaction · ${action.request.transactions.length} call(s)`;
    case "execute_svm":
      return `SVM transaction · ${action.request.transactions.length} leg(s)`;
    case "sign":
      return `${action.request.chainFamily.toUpperCase()} signing · ${action.request.description}`;
  }
}

function readChainId(wallets: Wallets): number | undefined {
  const value = wallets.evm?.chainId;
  return typeof value === "function" ? value() : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
