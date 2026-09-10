import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearEmptyEditorStructure,
  SupportedChainStack,
  matchCapabilityMentionTrigger,
  removeCapabilityMentionBeforeCaret,
  textFromEditor,
} from "./capability-composer";

afterEach(cleanup);

describe("SupportedChainStack", () => {
  it("shows three declared chain marks and a compact overflow count", () => {
    const { container } = render(
      <SupportedChainStack chainIds={[1, 8453, 10, 42161]} />,
    );

    expect(
      screen.getByLabelText("Supported on Ethereum, Base, Optimism, Arbitrum"),
    ).toBeTruthy();
    expect(container.querySelectorAll("svg")).toHaveLength(3);
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("stays absent when chain support was not declared", () => {
    const { container } = render(<SupportedChainStack />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("matchCapabilityMentionTrigger", () => {
  it("keeps a multi-word capability query active", () => {
    expect(matchCapabilityMentionTrigger("Use @arbitrum bridge")).toEqual({
      query: "arbitrum bridge",
      start: 4,
    });
  });

  it("starts a fresh query after a later at sign", () => {
    expect(matchCapabilityMentionTrigger("@aave v3 then @base sep")).toEqual({
      query: "base sep",
      start: 14,
    });
  });

  it("does not continue a trigger across a new line", () => {
    expect(matchCapabilityMentionTrigger("@aave v3\nnext line")).toBeNull();
  });
});

describe("removeCapabilityMentionBeforeCaret", () => {
  it("removes an adjacent mention and its separator as one unit", () => {
    const editor = document.createElement("div");
    const mention = document.createElement("span");
    mention.dataset.capabilityKey = "app:name:default";
    mention.textContent = "Basic";
    const trailingText = document.createTextNode(" continue");
    editor.append(mention, trailingText);
    document.body.append(editor);

    const range = document.createRange();
    range.setStart(trailingText, 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(removeCapabilityMentionBeforeCaret(editor, selection)).toBe(true);
    expect(editor.querySelector("[data-capability-key]")).toBeNull();
    expect(editor.textContent).toBe("continue");
  });

  it("leaves ordinary text deletion to the browser", () => {
    const editor = document.createElement("div");
    const text = document.createTextNode("hello");
    editor.append(text);
    document.body.append(editor);

    const range = document.createRange();
    range.setStart(text, text.data.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(removeCapabilityMentionBeforeCaret(editor, selection)).toBe(false);
    expect(editor.textContent).toBe("hello");
  });
});

describe("textFromEditor", () => {
  it("serializes a visual logo mention as the stable routed token", () => {
    const editor = document.createElement("div");
    const mention = document.createElement("span");
    mention.dataset.capabilityKey = "app:name:default";
    mention.dataset.capabilityToken = "▦ Basic";
    mention.innerHTML = '<span aria-hidden="true"></span><span>Basic</span>';
    editor.append("Ask ", mention, " to help");
    document.body.append(editor);

    expect(textFromEditor(editor)).toBe("Ask ▦ Basic to help");
  });
});

describe("clearEmptyEditorStructure", () => {
  it("removes the residual line break left by an emptied contenteditable", () => {
    const editor = document.createElement("div");
    editor.append(document.createElement("br"));
    document.body.append(editor);

    expect(clearEmptyEditorStructure(editor)).toBe(true);
    expect(editor).toBeEmptyDOMElement();
  });

  it("preserves non-empty composer content", () => {
    const editor = document.createElement("div");
    editor.textContent = "hello";
    document.body.append(editor);

    expect(clearEmptyEditorStructure(editor)).toBe(false);
    expect(editor.textContent).toBe("hello");
  });
});
