import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  TextMessagePartProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { MarkdownText } from "./markdown-text";
import {
  EVM_EXPLORERS,
  explorerUrl,
  toolExplorerLinks,
} from "./explorer-links";

const ADDRESS = `0x${"a".repeat(40)}`;
const TOKEN = `0x${"b".repeat(40)}`;
const HASH = `0x${"c".repeat(64)}`;
const POOL = `0x${"d".repeat(64)}`;
const MINT = "So11111111111111111111111111111111111111112";
const SIGNATURE =
  "uzUc9i1WChEcyuQFT5v7Bn9s4WzGnbNqg8NPyDA8r7GRpmUsctac7hLvyvbiM1Cz3GC9KZZPvKD6RMAdoroX2Aj";

// Mirrors product-mono `PUBLIC_EXPLORERS`.
const MATRIX = [
  [1, "https://etherscan.io"],
  [11155111, "https://sepolia.etherscan.io"],
  [137, "https://polygonscan.com"],
  [42161, "https://arbiscan.io"],
  [10, "https://optimistic.etherscan.io"],
  [8453, "https://basescan.org"],
  [84532, "https://sepolia.basescan.org"],
  [59144, "https://lineascan.build"],
  [59141, "https://sepolia.lineascan.build"],
  [4326, "https://mega.etherscan.io"],
  [4663, "https://robinscan.io"],
  [46630, "https://explorer.testnet.chain.robinhood.com"],
  [143, "https://monadscan.com"],
  [10143, "https://testnet.monadscan.com"],
  [5042, "https://explorer.arc.io"],
  [5042002, "https://explorer.testnet.arc.io"],
  [2092151908, "https://testnet-unifi-explorer.puffer.fi"],
] as const;

const toolCall = (result: unknown) => ({ type: "tool-call", result });

function Fixture({ text, result }: { text: string; result: unknown }) {
  const messages: ThreadMessageLike[] = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "research",
          toolName: "research",
          args: {},
          argsText: "{}",
          result,
        },
        { type: "text", text },
      ],
    },
  ];
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: false,
    onNew: async () => {},
    convertMessage: (message) => message,
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages
          components={{
            UserMessage: () => null,
            AssistantMessage: () => (
              <MessagePrimitive.Root>
                <MessagePrimitive.Parts
                  components={{
                    Text: MarkdownText,
                    tools: { Fallback: () => null },
                  }}
                />
              </MessagePrimitive.Root>
            ),
          }}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

afterEach(cleanup);

describe("explorerUrl", () => {
  it("covers every public EVM explorer and Solana cluster", () => {
    for (const [chain, base] of MATRIX) {
      expect(EVM_EXPLORERS[chain]?.base).toBe(base);
      expect(explorerUrl(chain, "address", ADDRESS)).toBe(
        `${base}/address/${ADDRESS}`,
      );
      expect(explorerUrl(chain, "tx", HASH)).toBe(`${base}/tx/${HASH}`);
    }
    expect(explorerUrl("mainnet-beta", "address", MINT)).toBe(
      `https://solscan.io/account/${MINT}`,
    );
    expect(explorerUrl("mainnet-beta", "tx", SIGNATURE)).toBe(
      `https://solscan.io/tx/${SIGNATURE}`,
    );
    expect(explorerUrl("devnet", "token", MINT)).toBe(
      `https://explorer.solana.com/address/${MINT}?cluster=devnet`,
    );
  });

  it("rejects unknown chains and malformed or mistyped identifiers", () => {
    expect(explorerUrl(31337, "address", ADDRESS)).toBeNull();
    expect(explorerUrl(5, "address", ADDRESS)).toBeNull();
    expect(explorerUrl(1, "tx", ADDRESS)).toBeNull();
    expect(explorerUrl(1, "address", `${ADDRESS}a`)).toBeNull();
    expect(explorerUrl("mainnet-beta", "tx", MINT)).toBeNull();
  });
});

describe("toolExplorerLinks", () => {
  it("types identifiers by field and takes the chain from the result", () => {
    const links = toolExplorerLinks([
      toolCall({
        chain_id: 4663,
        holders: [{ wallet: ADDRESS }],
        token_address: TOKEN,
      }),
      toolCall(JSON.stringify({ cluster: "mainnet-beta", mint: MINT })),
    ]);
    expect(links.get(ADDRESS)).toBe(`https://robinscan.io/address/${ADDRESS}`);
    expect(links.get(TOKEN)).toBe(`https://robinscan.io/token/${TOKEN}`);
    expect(links.get(MINT)).toBe(`https://solscan.io/token/${MINT}`);
  });

  it("never guesses a chain and fails closed on conflicts and pool IDs", () => {
    const links = toolExplorerLinks([
      toolCall({ address: ADDRESS }),
      toolCall({ chain_id: 8453, token_address: TOKEN }),
      toolCall({ chain_id: 1, token_address: TOKEN }),
      toolCall({ chain_id: "unknown", nested: { address: ADDRESS } }),
      toolCall({ chain_id: 8453, block_hash: POOL }),
      toolCall({ pool_id: POOL }),
    ]);
    expect(links.has(ADDRESS)).toBe(false);
    expect(links.get(TOKEN)).toBeNull();
    expect(links.get(POOL)).toBeNull();
  });

  it("links a transaction only alongside the host's matching public URL", () => {
    const url = `https://basescan.org/tx/${HASH}`;
    expect(
      toolExplorerLinks([
        toolCall({ chain_id: 8453, transaction_hash: HASH }),
      ]).has(HASH),
    ).toBe(false);
    expect(
      toolExplorerLinks([
        toolCall({
          chain_family: "evm",
          chain_ref: "8453",
          transaction_id: HASH,
          transaction_url: url,
        }),
      ]).get(HASH),
    ).toBe(url);
  });
});

describe("MarkdownText explorer links", () => {
  it("links bare identifiers and leaves authored links and code alone", async () => {
    const { container } = render(
      <Fixture
        result={{ chain_id: 4663, address: ADDRESS, token_address: TOKEN }}
        text={`Seller \`${ADDRESS}\`, token ${TOKEN}.\n\n[Original](https://example.com/${TOKEN})\n\n\`query(${ADDRESS})\`\n\n\`\`\`js\n${ADDRESS}\n\`\`\``}
      />,
    );
    await screen.findByRole("link", {
      name: `${ADDRESS} on Robinhood Chain explorer`,
    });
    expect(
      container.querySelectorAll('a[href^="https://robinscan.io/"]'),
    ).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Original" })).toHaveAttribute(
      "href",
      `https://example.com/${TOKEN}`,
    );
    expect(screen.getByText(`query(${ADDRESS})`).closest("a")).toBeNull();
    expect(container.querySelector("pre a")).toBeNull();
  });

  it("renders detached text without a message runtime", () => {
    render(
      <TextMessagePartProvider text={`Working on ${ADDRESS}`}>
        <MarkdownText />
      </TextMessagePartProvider>,
    );
    expect(screen.getByText(`Working on ${ADDRESS}`)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
