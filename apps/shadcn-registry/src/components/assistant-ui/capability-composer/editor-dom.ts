export type TriggerRange = {
  node: Text;
  start: number;
  end: number;
};

export type ButtonTriggerRange = {
  marker: HTMLSpanElement;
  endNode: Node;
  end: number;
};

export function matchCapabilityMentionTrigger(beforeCaret: string): {
  query: string;
  start: number;
} | null {
  const match = beforeCaret.match(/(?:^|\s)@([^@\n]*)$/u);
  if (!match) return null;
  return {
    query: match[1] ?? "",
    start: beforeCaret.lastIndexOf("@"),
  };
}

export function detectTrigger(): { query: string; range: TriggerRange } | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !(selection.anchorNode instanceof Text)) {
    return null;
  }
  const before = selection.anchorNode.data.slice(0, selection.anchorOffset);
  const match = matchCapabilityMentionTrigger(before);
  if (!match) return null;
  return {
    query: match.query,
    range: {
      node: selection.anchorNode,
      start: match.start,
      end: selection.anchorOffset,
    },
  };
}

export function detectAnchoredTrigger(
  trigger: ButtonTriggerRange | null,
  editor: HTMLDivElement,
): { query: string; range: ButtonTriggerRange } | null {
  const selection = window.getSelection();
  if (
    !trigger ||
    !trigger.marker.isConnected ||
    !selection?.isCollapsed ||
    !selection.anchorNode ||
    !editor.contains(selection.anchorNode) ||
    !(
      trigger.marker.compareDocumentPosition(selection.anchorNode) &
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  ) {
    return null;
  }
  try {
    const range = document.createRange();
    range.setStartAfter(trigger.marker);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return {
      query: range.toString(),
      range: {
        marker: trigger.marker,
        endNode: selection.anchorNode,
        end: selection.anchorOffset,
      },
    };
  } catch {
    return null;
  }
}

export function textFromEditor(editor: HTMLDivElement): string {
  const mirror = editor.cloneNode(true) as HTMLDivElement;
  mirror
    .querySelectorAll<HTMLElement>("[data-capability-key]")
    .forEach((mention) => {
      mention.replaceWith(
        document.createTextNode(mention.dataset.capabilityToken ?? ""),
      );
    });
  mirror
    .querySelectorAll<HTMLElement>("[data-capability-picker-anchor]")
    .forEach((anchor) => anchor.remove());
  mirror.contentEditable = "false";
  mirror.setAttribute("aria-hidden", "true");
  mirror.style.cssText =
    "position:fixed;left:-10000px;top:0;width:720px;pointer-events:none;opacity:0";
  document.body.append(mirror);
  const text = mirror.innerText ?? mirror.textContent ?? "";
  mirror.remove();
  return text.replaceAll("\u00a0", " ").replaceAll("\u200b", "");
}

export function clearEmptyEditorStructure(editor: HTMLDivElement): boolean {
  if (textFromEditor(editor).trim().length > 0) return false;
  const hadStructure = editor.childNodes.length > 0;
  editor.replaceChildren();
  return hadStructure;
}

export function mentionKeysFromEditor(editor: HTMLDivElement): Set<string> {
  return new Set(
    [...editor.querySelectorAll<HTMLElement>("[data-capability-key]")]
      .map((node) => node.dataset.capabilityKey)
      .filter((key): key is string => Boolean(key)),
  );
}

function isCapabilityMention(node: Node | null): node is HTMLElement {
  return (
    node instanceof HTMLElement && node.hasAttribute("data-capability-key")
  );
}

export function removeCapabilityMentionBeforeCaret(
  editor: HTMLDivElement,
  selection: Selection | null = window.getSelection(),
): boolean {
  if (
    !selection?.isCollapsed ||
    !selection.anchorNode ||
    !editor.contains(selection.anchorNode)
  ) {
    return false;
  }

  const anchor = selection.anchorNode;
  const offset = selection.anchorOffset;
  let mention: HTMLElement | null = null;
  let separator: Text | null = null;
  let separatorOffset = 0;

  const containingMention =
    anchor instanceof Element
      ? anchor.closest<HTMLElement>("[data-capability-key]")
      : anchor.parentElement?.closest<HTMLElement>("[data-capability-key]");
  if (containingMention && editor.contains(containingMention)) {
    mention = containingMention;
  } else if (anchor instanceof Text) {
    const beforeCaret = anchor.data.slice(0, offset);
    if (
      /^\s*$/u.test(beforeCaret) &&
      isCapabilityMention(anchor.previousSibling)
    ) {
      mention = anchor.previousSibling;
      separator = anchor;
      separatorOffset = offset;
    }
  } else {
    const priorNode = anchor.childNodes[offset - 1] ?? null;
    if (isCapabilityMention(priorNode)) {
      mention = priorNode;
    } else if (
      priorNode instanceof Text &&
      /^\s*$/u.test(priorNode.data) &&
      isCapabilityMention(priorNode.previousSibling)
    ) {
      mention = priorNode.previousSibling;
      separator = priorNode;
      separatorOffset = priorNode.data.length;
    }
  }

  if (!mention) return false;

  const caretRange = document.createRange();
  if (separator) {
    separator.deleteData(0, separatorOffset);
    caretRange.setStart(separator, 0);
  } else {
    caretRange.setStartBefore(mention);
  }
  caretRange.collapse(true);
  mention.remove();
  selection.removeAllRanges();
  selection.addRange(caretRange);
  return true;
}
