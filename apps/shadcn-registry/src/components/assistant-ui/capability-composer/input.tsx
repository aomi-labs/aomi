"use client";
import { unstable_useComposerInput } from "@assistant-ui/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FC,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useCapabilityComposer } from "./provider";
import { useCapabilityCatalog } from "./catalog";
import { CapabilityPicker } from "./picker";
import {
  CAPABILITY_MENTION_REQUEST_EVENT,
  type CapabilityMentionRequest,
  type PickerItem,
} from "./model";
import {
  clearEmptyEditorStructure,
  detectAnchoredTrigger,
  detectTrigger,
  mentionKeysFromEditor,
  removeCapabilityMentionBeforeCaret,
  textFromEditor,
  type ButtonTriggerRange,
  type TriggerRange,
} from "./editor-dom";

export const CapabilityMentionInput: FC<{
  placeholder: string;
  className: string;
}> = ({ placeholder, className }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerId = useId();
  const triggerRef = useRef<TriggerRange | null>(null);
  const buttonTriggerRef = useRef<ButtonTriggerRange | null>(null);
  const pickerSourceRef = useRef<"mention" | "button" | null>(null);
  const lastTextRef = useRef("");
  const [query, setQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const [hasText, setHasText] = useState(false);
  const [mentionIconPortals, setMentionIconPortals] = useState<
    Array<{
      target: HTMLSpanElement;
      Icon: PickerItem["Icon"];
    }>
  >([]);
  const { value, setText, isDisabled } = unstable_useComposerInput();
  const {
    mentions,
    addMention,
    retainMentions,
    hintsEnabled,
    capabilityPickerRequest,
    consumeCapabilityPickerRequest,
  } = useCapabilityComposer();
  const items = useCapabilityCatalog();

  useEffect(() => () => retainMentions(new Set()), [retainMentions]);

  const visibleGroups = useMemo(() => {
    if (!hintsEnabled || query === null) return [];
    const needle = query.trim().toLowerCase();
    const selectedKeys = new Set(mentions.map((mention) => mention.key));
    const matching = items.filter(
      (item) =>
        !selectedKeys.has(item.key) &&
        (needle
          ? `${item.label} ${item.searchText}`.toLowerCase().includes(needle)
          : true),
    );
    return (
      [
        { kind: "app", label: "Apps" },
        { kind: "skill", label: "Skills" },
        { kind: "chain", label: "Chains" },
      ] as const
    )
      .map((group) => ({
        ...group,
        items: matching.filter((item) => item.kind === group.kind),
      }))
      .filter((group) => group.items.length > 0);
  }, [hintsEnabled, items, mentions, query]);

  const visibleItems = useMemo(
    () => visibleGroups.flatMap((group) => group.items),
    [visibleGroups],
  );

  useEffect(() => {
    setHighlighted(query !== null && visibleItems.length > 0 ? 0 : -1);
  }, [query, visibleItems.length]);

  const closePicker = useCallback(() => {
    buttonTriggerRef.current?.marker.remove();
    buttonTriggerRef.current = null;
    pickerSourceRef.current = null;
    triggerRef.current = null;
    setQuery(null);
  }, []);

  useEffect(() => {
    if (query === null) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        editorRef.current?.contains(target) ||
        pickerRef.current?.contains(target)
      ) {
        return;
      }
      closePicker();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () =>
      document.removeEventListener(
        "pointerdown",
        handleOutsidePointerDown,
        true,
      );
  }, [closePicker, query]);

  const syncPicker = useCallback(() => {
    if (!hintsEnabled) {
      closePicker();
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    if (pickerSourceRef.current === "button") {
      const trigger = detectAnchoredTrigger(buttonTriggerRef.current, editor);
      if (!trigger) {
        closePicker();
        return;
      }
      buttonTriggerRef.current = trigger.range;
      setQuery(trigger.query);
      return;
    }

    const trigger = detectTrigger();
    if (!trigger) {
      closePicker();
      return;
    }
    pickerSourceRef.current = "mention";
    triggerRef.current = trigger.range;
    setQuery(trigger.query);
  }, [closePicker, hintsEnabled]);

  const syncEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const text = textFromEditor(editor);
    const normalizedText = text.trim().length === 0 ? "" : text;
    if (!normalizedText && editor.textContent) editor.textContent = "";
    lastTextRef.current = normalizedText;
    setHasText(normalizedText.length > 0);
    setText(normalizedText);
    retainMentions(mentionKeysFromEditor(editor));
    setMentionIconPortals((current) =>
      current.filter(({ target }) => target.isConnected),
    );
    syncPicker();
  }, [retainMentions, setText, syncPicker]);

  useEffect(() => {
    if (highlighted < 0) return;
    const picker = pickerRef.current;
    const option = picker?.querySelector<HTMLElement>(
      `[data-capability-index="${highlighted}"]`,
    );
    if (!picker || !option) return;

    const pickerBounds = picker.getBoundingClientRect();
    const optionBounds = option.getBoundingClientRect();
    if (optionBounds.top < pickerBounds.top) {
      picker.scrollTop -= pickerBounds.top - optionBounds.top;
    } else if (optionBounds.bottom > pickerBounds.bottom) {
      picker.scrollTop += optionBounds.bottom - pickerBounds.bottom;
    }
  }, [highlighted]);

  useEffect(() => {
    if (hintsEnabled) return;
    const editor = editorRef.current;
    if (!editor) return;
    editor
      .querySelectorAll<HTMLElement>("[data-capability-key]")
      .forEach((node) => node.remove());
    setMentionIconPortals([]);
    closePicker();
    syncEditor();
  }, [closePicker, hintsEnabled, syncEditor]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastTextRef.current) return;
    editor.textContent = value;
    setMentionIconPortals([]);
    lastTextRef.current = value;
    setHasText(value.trim().length > 0);
    closePicker();
    if (value.trim().length === 0) retainMentions(new Set());
  }, [closePicker, retainMentions, value]);

  useEffect(() => {
    if (capabilityPickerRequest === 0 || !hintsEnabled || isDisabled) return;
    const editor = editorRef.current;
    if (!editor) return;

    closePicker();
    clearEmptyEditorStructure(editor);
    const selection = window.getSelection();
    const selectionNode = selection?.anchorNode;
    const selectionInsideMention =
      selectionNode instanceof Text &&
      selectionNode.parentElement?.closest("[data-capability-key]");
    let node: Text;
    let offset: number;
    if (
      selection?.isCollapsed &&
      selectionNode instanceof Text &&
      editor.contains(selectionNode) &&
      !selectionInsideMention
    ) {
      node = selectionNode;
      offset = selection.anchorOffset;
    } else if (editor.lastChild instanceof Text) {
      node = editor.lastChild;
      offset = node.data.length;
    } else {
      node = document.createTextNode("");
      editor.append(node);
      offset = 0;
    }

    const marker = document.createElement("span");
    marker.contentEditable = "false";
    marker.dataset.capabilityPickerAnchor = "";
    marker.setAttribute("aria-hidden", "true");
    marker.className =
      "pointer-events-none inline-block h-0 w-0 overflow-hidden align-baseline";
    marker.textContent = "\u200b";
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    range.insertNode(marker);
    const inputNode = document.createTextNode("");
    marker.after(inputNode);
    range.setStart(inputNode, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.focus();

    pickerSourceRef.current = "button";
    buttonTriggerRef.current = { marker, endNode: inputNode, end: 0 };
    setQuery("");
    setHighlighted(0);
    consumeCapabilityPickerRequest();
  }, [
    capabilityPickerRequest,
    closePicker,
    consumeCapabilityPickerRequest,
    hintsEnabled,
    isDisabled,
  ]);

  const insertItemAtRange = useCallback(
    (item: PickerItem, range: Range) => {
      const editor = editorRef.current;
      if (!editor) return;
      range.deleteContents();

      const mention = document.createElement("span");
      mention.contentEditable = "false";
      mention.dataset.capabilityKey = item.key;
      mention.dataset.capabilityKind = item.kind;
      mention.className =
        "text-aomi-accent relative top-px mx-0.5 inline-flex items-center gap-1 whitespace-nowrap align-baseline font-medium";
      const glyph =
        item.kind === "skill" ? "✦" : item.kind === "app" ? "▦" : "◇";
      mention.dataset.capabilityToken = `${glyph} ${item.label}`;
      const iconTarget = document.createElement("span");
      iconTarget.setAttribute("aria-hidden", "true");
      iconTarget.className =
        "inline-flex size-3.5 shrink-0 items-center justify-center";
      const label = document.createElement("span");
      label.textContent = item.label;
      mention.append(iconTarget, label);
      mention.setAttribute("aria-label", `${item.kind} ${item.label}`);
      range.insertNode(mention);
      setMentionIconPortals((current) => [
        ...current,
        { target: iconTarget, Icon: item.Icon },
      ]);
      const space = document.createTextNode(" ");
      mention.after(space);

      const selection = window.getSelection();
      range.setStartAfter(space);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);

      addMention(item);
      closePicker();
      syncEditor();
      editor.focus();
    },
    [addMention, closePicker, syncEditor],
  );

  const selectItem = useCallback(
    (item: PickerItem) => {
      const range = document.createRange();
      if (pickerSourceRef.current === "button") {
        const trigger = buttonTriggerRef.current;
        if (!trigger?.marker.isConnected || !trigger.endNode.isConnected)
          return;
        range.setStartBefore(trigger.marker);
        range.setEnd(trigger.endNode, trigger.end);
      } else {
        const trigger = triggerRef.current;
        if (!trigger?.node.isConnected) return;
        range.setStart(trigger.node, trigger.start);
        range.setEnd(trigger.node, trigger.end);
      }
      insertItemAtRange(item, range);
    },
    [insertItemAtRange],
  );

  useEffect(() => {
    const insertRequestedMention = (rawEvent: Event) => {
      if (!hintsEnabled || isDisabled) return;
      const request = (rawEvent as CustomEvent<CapabilityMentionRequest>)
        .detail;
      if (!request) return;
      const item = items.find(
        (candidate) =>
          candidate.kind === request.kind && candidate.id === request.id,
      );
      const editor = editorRef.current;
      if (!item || !editor) return;
      if (mentions.some((mention) => mention.key === item.key)) {
        editor.focus();
        return;
      }

      closePicker();
      clearEmptyEditorStructure(editor);
      const range = document.createRange();
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const selectionInsideEditor =
        selection?.isCollapsed && anchor && editor.contains(anchor);
      const selectionInsideMention =
        anchor instanceof Text &&
        anchor.parentElement?.closest("[data-capability-key]");
      if (selectionInsideEditor && !selectionInsideMention) {
        range.setStart(anchor, selection.anchorOffset);
      } else {
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      range.collapse(true);
      insertItemAtRange(item, range);
    };

    window.addEventListener(
      CAPABILITY_MENTION_REQUEST_EVENT,
      insertRequestedMention,
    );
    return () =>
      window.removeEventListener(
        CAPABILITY_MENTION_REQUEST_EVENT,
        insertRequestedMention,
      );
  }, [
    closePicker,
    hintsEnabled,
    insertItemAtRange,
    isDisabled,
    items,
    mentions,
  ]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (
      event.key === "Backspace" &&
      editorRef.current &&
      removeCapabilityMentionBeforeCaret(editorRef.current)
    ) {
      event.preventDefault();
      closePicker();
      syncEditor();
      return;
    }
    if (query !== null && visibleItems.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((value) =>
          value < 0 ? 0 : (value + 1) % visibleItems.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((value) =>
          value < 0
            ? visibleItems.length - 1
            : (value - 1 + visibleItems.length) % visibleItems.length,
        );
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        selectItem(visibleItems[highlighted] ?? visibleItems[0]!);
        return;
      }
    }
    if (event.key === "Escape" && query !== null) {
      event.preventDefault();
      closePicker();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      editorRef.current?.closest("form")?.requestSubmit();
    }
  };

  return (
    <>
      <div className="relative">
        {!hasText ? (
          <span className="text-aomi-muted pointer-events-none absolute left-4 top-1.5 text-[13px]">
            {placeholder}
          </span>
        ) : null}
        <div
          ref={editorRef}
          role="textbox"
          aria-label="Message input"
          aria-multiline="true"
          aria-autocomplete="list"
          aria-expanded={query !== null}
          aria-controls={query !== null ? pickerId : undefined}
          aria-activedescendant={
            query !== null && highlighted >= 0
              ? `${pickerId}-option-${highlighted}`
              : undefined
          }
          contentEditable={!isDisabled}
          suppressContentEditableWarning
          onInput={syncEditor}
          onKeyDown={handleKeyDown}
          className={`${className} min-h-[30px]`}
        />
        {hintsEnabled && query !== null ? (
          <CapabilityPicker
            pickerId={pickerId}
            pickerRef={pickerRef}
            visibleGroups={visibleGroups}
            highlighted={highlighted}
            onHighlight={setHighlighted}
            onSelect={selectItem}
          />
        ) : null}
      </div>
      {mentionIconPortals.map(({ target, Icon }) =>
        createPortal(<Icon className="size-3.5" />, target),
      )}
    </>
  );
};
