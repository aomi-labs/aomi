import { act, render, screen, waitFor } from "@testing-library/react";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  TextMessagePartProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  useMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { describe, expect, it, vi } from "vitest";

const parse = vi.hoisted(() => vi.fn());
vi.mock("remark-gfm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("remark-gfm")>();
  return {
    default: function (
      this: ThisParameterType<typeof actual.default>,
      ...args: Parameters<typeof actual.default>
    ) {
      parse();
      return actual.default.apply(this, args);
    },
  };
});
import { MarkdownText } from "./markdown-text";

const address = "0x1111111111111111111111111111111111111111";
const displayedText = `Observed **balance** for ${address}`;
function AssistantMessage() {
  const text = useMessage((state) =>
    state.content[0].type === "text" ? state.content[0].text : "",
  );
  return (
    <MessagePrimitive.Root>
      <TextMessagePartProvider text={text}>
        <MarkdownText />
      </TextMessagePartProvider>
    </MessagePrimitive.Root>
  );
}
function Fixture({
  result,
  text = displayedText,
}: {
  result: unknown;
  text?: string;
}) {
  const messages: ThreadMessageLike[] = [
    {
      id: "message",
      role: "assistant",
      content: [
        { type: "text", text },
        {
          type: "tool-call",
          toolCallId: "tool",
          toolName: "balance",
          args: {},
          result,
        },
      ],
    },
  ];
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: true,
    onNew: async () => {},
    convertMessage: (message) => message,
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages
          components={{ UserMessage: () => null, AssistantMessage }}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

describe("Markdown display publication", () => {
  it("does not parse unchanged text for unrelated tool updates, but renders changed text and explorer meaning immediately", async () => {
    parse.mockClear();
    const view = render(<Fixture result={{ rows: [{ balance: "1" }] }} />);
    await screen.findByText("balance", { selector: "strong" });
    const initialParses = parse.mock.calls.length;
    expect(initialParses).toBeGreaterThan(0);
    for (let step = 0; step < 10; step++) {
      await act(async () =>
        view.rerender(
          <Fixture result={{ rows: [{ balance: String(step) }] }} />,
        ),
      );
    }
    expect(parse).toHaveBeenCalledTimes(initialParses);
    await act(async () =>
      view.rerender(
        <Fixture
          result={{ rows: [] }}
          text={`Updated **balance** for ${address}`}
        />,
      ),
    );
    expect(screen.getByText(/Updated/)).toBeVisible();
    expect(parse.mock.calls.length).toBeGreaterThan(initialParses);

    await act(async () =>
      view.rerender(
        <Fixture
          text={`Updated **balance** for ${address}`}
          result={{ address, chain_id: 1 }}
        />,
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: new RegExp(address) }),
      ).toHaveAttribute("href", `https://etherscan.io/address/${address}`),
    );
    const linkedParses = parse.mock.calls.length;
    await act(async () =>
      view.rerender(
        <Fixture
          text={`Updated **balance** for ${address}`}
          result={{ address, chain_id: 1, balance: "2" }}
        />,
      ),
    );
    expect(parse).toHaveBeenCalledTimes(linkedParses);
    await act(async () =>
      view.rerender(
        <Fixture
          text={`Updated **balance** for ${address}`}
          result={{ address, chain_id: 8453 }}
        />,
      ),
    );
    expect(
      screen.getByRole("link", { name: new RegExp(address) }),
    ).toHaveAttribute("href", `https://basescan.org/address/${address}`);
    expect(parse.mock.calls.length).toBeGreaterThan(linkedParses);
    await act(async () => view.rerender(<Fixture result={{ rows: [] }} />));
    expect(
      screen.queryByRole("link", { name: new RegExp(address) }),
    ).toBeNull();
  });
});
