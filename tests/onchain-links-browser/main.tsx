import { createRoot } from "react-dom/client";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { MarkdownText } from "../../apps/shadcn-registry/src/components/assistant-ui/markdown-text";
import "../../apps/shadcn-registry/src/package.css";

const account = "So11111111111111111111111111111111111111112";
const transaction =
  "uzUc9i1WChEcyuQFT5v7Bn9s4WzGnbNqg8NPyDA8r7GRpmUsctac7hLvyvbiM1Cz3GC9KZZPvKD6RMAdoroX2Aj";
const address = `0x${"b".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;
const markdown = [
  `Account: [Solana account](https://solscan.io/account/${account}).`,
  `Token: [Wrapped SOL](https://solscan.io/token/${account}).`,
  `Transaction: [Solana transaction](https://solscan.io/tx/${transaction}).`,
  `Already linked code: [\`${account}\`](https://SOLSCAN.io:443/account/${account}).`,
  `Reference: [same account][account]. Autolink: <https://solscan.io/account/${account}>.`,
  `Existing Base: [Base account](https://basescan.org/address/${address}).`,
  `Existing Robinhood: [Robinhood account](https://robinhoodchain.blockscout.com/address/${address}).`,
  `Unsupported: [Devnet](https://solscan.io/account/${account}?cluster=devnet), [wrong size](https://solscan.io/tx/${account}).`,
  `Bare ambiguous identifiers: ${account}, ${transaction}, ${address}, ${hash}.`,
  `Inline code: \`${account}\`.`,
  `\`\`\`text\n[code only](https://solscan.io/account/${account})\n\`\`\``,
  `[account]: https://solscan.io/account/${account}`,
].join("\n\n");

function AssistantMessage() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
    </MessagePrimitive.Root>
  );
}

function Fixture() {
  const runtime = useExternalStoreRuntime({
    messages: [{ role: "assistant" as const, content: markdown }],
    isRunning: false,
    onNew: async () => undefined,
    convertMessage: (message) => message,
  });
  return (
    <main style={{ padding: 24, maxWidth: 960, fontFamily: "system-ui" }}>
      <h1>Existing explorer links</h1>
      <p>Shared assistant Markdown renderer · local controlled fixture</p>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages components={{ AssistantMessage }} />
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
