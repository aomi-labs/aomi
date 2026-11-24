"use client";
import { useComposerRuntime } from "@assistant-ui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  useAomiDisplayCache,
  useChatView,
  useControl,
  useThreadContext,
} from "@aomi-labs/react";
import {
  normalizeAomiRouting,
  sameDirectRoutingAgent,
  toAgentTarget,
  type AomiRoutingConfig,
  type DirectRoutingAgent,
} from "@/controls/routing";
import { buildCapabilityHintPayload } from "@/thread/capability-hint-payload";
import {
  CAPABILITY_MENTION_REQUEST_EVENT,
  type AgentTagRequest,
  type CapabilityMention,
  type CapabilityMentionRequest,
  type ExecutionPolicy,
} from "./model";

type CapabilityComposerContextValue = {
  mentions: CapabilityMention[];
  policy: ExecutionPolicy;
  /** Explicit host tag or active Direct target; an Auto allowlist is not selection. */
  selectedAgent: DirectRoutingAgent | AgentTagRequest | null;
  hintsEnabled: boolean;
  hostError: string | null;
  capabilityPickerRequest: number;
  /** A host agent tag or the Library's "Use in chat", waiting for the input. */
  tagRequest: CapabilityMentionRequest | null;
  consumeTagRequest: () => void;
  openCapabilityPicker: () => void;
  consumeCapabilityPickerRequest: () => void;
  addMention: (mention: CapabilityMention) => void;
  retainMentions: (keys: ReadonlySet<string>) => void;
  prepareSubmit: (event: FormEvent<HTMLFormElement>) => void;
  enabledAgentIds?: readonly string[];
  allowAgentMentions: boolean;
};

const CapabilityComposerContext =
  createContext<CapabilityComposerContextValue | null>(null);

export function useCapabilityComposer(): CapabilityComposerContextValue {
  const value = useContext(CapabilityComposerContext);
  if (!value) {
    throw new Error(
      "useCapabilityComposer must be used inside CapabilityComposerProvider",
    );
  }
  return value;
}

export function CapabilityComposerProvider({
  children,
  enabledAgentIds,
  routing,
  initialAgentTag,
}: {
  children: ReactNode;
  enabledAgentIds?: readonly string[];
  routing?: AomiRoutingConfig;
  initialAgentTag?: AgentTagRequest;
}) {
  const { onAgentModeSelect, onAgentTargetSelect } = useControl();
  const threadContext = useThreadContext();
  const view = useChatView();
  const composerRuntime = useComposerRuntime();
  const normalizedRouting = useMemo(
    () => normalizeAomiRouting(routing),
    [routing],
  );
  if (normalizedRouting.error && process.env.NODE_ENV !== "production") {
    throw new Error(`[AomiWidget] ${normalizedRouting.error}`);
  }
  const currentControl = threadContext.getThreadMetadata(
    threadContext.currentThreadId,
  )?.control;
  const storedMode = currentControl?.agentMode;
  const policy: ExecutionPolicy = normalizedRouting.defaultMode;
  const currentDirectAgent: DirectRoutingAgent | null = currentControl?.agent
    ? { agent: currentControl.agent }
    : null;
  const selectedDirectAgent =
    (currentDirectAgent
      ? normalizedRouting.directAgents.find((candidate) =>
          sameDirectRoutingAgent(candidate, currentDirectAgent),
        )
      : undefined) ??
    normalizedRouting.directAgents[0] ??
    null;
  const selectedAgent =
    initialAgentTag ?? (policy === "direct" ? selectedDirectAgent : null);
  const [mentions, setMentions] = useState<CapabilityMention[]>(
    () =>
      (view?.store.get(view.threadId)?.mentions ?? []) as CapabilityMention[],
  );

  useEffect(
    () =>
      composerRuntime.unstable_on("send", () => {
        // The runtime has already captured this turn's runConfig.
        setMentions([]);
      }),
    [composerRuntime],
  );
  const [capabilityPickerRequest, setCapabilityPickerRequest] = useState(0);

  const previousPolicy = useRef(policy);
  const previousThread = useRef(threadContext.currentThreadId);
  useEffect(() => {
    if (
      previousPolicy.current !== policy ||
      (!view && previousThread.current !== threadContext.currentThreadId)
    )
      setMentions([]);
    previousThread.current = threadContext.currentThreadId;
    previousPolicy.current = policy;
  }, [policy, view, threadContext.currentThreadId]);
  useEffect(() => {
    view?.store.patch(view.threadId, { mentions });
  }, [view, mentions]);

  // Offer the host's agent tag once, after the mount-time mention reset above.
  const [tagRequest, setTagRequest] = useState<CapabilityMentionRequest | null>(
    null,
  );
  const agentTagKey = initialAgentTag ? initialAgentTag.agent : "";
  const offeredAgentTag = useRef("");
  useEffect(() => {
    if (!initialAgentTag || offeredAgentTag.current === agentTagKey) return;
    offeredAgentTag.current = agentTagKey;
    setTagRequest({ kind: "agent", id: initialAgentTag.agent });
  }, [agentTagKey, initialAgentTag]);
  const frame = useAomiDisplayCache()?.client;
  useEffect(() => {
    const receive = (event: Event) => {
      const { detail } = event as CustomEvent<{
        request: CapabilityMentionRequest;
        frame: unknown;
      }>;
      if (detail.frame === frame) setTagRequest(detail.request);
    };
    window.addEventListener(CAPABILITY_MENTION_REQUEST_EVENT, receive);
    return () =>
      window.removeEventListener(CAPABILITY_MENTION_REQUEST_EVENT, receive);
  }, [frame]);
  const consumeTagRequest = useCallback(() => setTagRequest(null), []);

  useEffect(() => {
    if (normalizedRouting.error) return;
    if (policy === "auto") {
      if (storedMode && storedMode !== "auto") {
        onAgentModeSelect("auto", { persist: false });
      }
      return;
    }
    if (
      selectedDirectAgent &&
      (storedMode !== "direct" ||
        !currentDirectAgent ||
        !sameDirectRoutingAgent(selectedDirectAgent, currentDirectAgent))
    ) {
      onAgentTargetSelect(toAgentTarget(selectedDirectAgent), {
        persist: false,
      });
    }
  }, [
    currentDirectAgent,
    normalizedRouting,
    onAgentModeSelect,
    onAgentTargetSelect,
    policy,
    selectedDirectAgent,
    storedMode,
  ]);

  const hintsEnabled = policy === "auto";

  const openCapabilityPicker = useCallback(() => {
    if (!hintsEnabled) return;
    setCapabilityPickerRequest((request) => request + 1);
  }, [hintsEnabled]);
  const consumeCapabilityPickerRequest = useCallback(() => {
    setCapabilityPickerRequest(0);
  }, []);

  const { addMention, retainMentions } = useMentionEdits(
    setMentions,
    hintsEnabled,
  );
  useHintRunConfig(policy, mentions);

  const prepareSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      if (normalizedRouting.error) event.preventDefault();
    },
    [normalizedRouting.error],
  );

  const value = useMemo<CapabilityComposerContextValue>(
    () => ({
      mentions,
      policy,
      selectedAgent,
      hintsEnabled,
      hostError: normalizedRouting.error,
      capabilityPickerRequest,
      tagRequest,
      consumeTagRequest,
      openCapabilityPicker,
      consumeCapabilityPickerRequest,
      addMention,
      retainMentions,
      prepareSubmit,
      enabledAgentIds,
      allowAgentMentions: hintsEnabled,
    }),
    [
      addMention,
      capabilityPickerRequest,
      consumeCapabilityPickerRequest,
      consumeTagRequest,
      enabledAgentIds,
      hintsEnabled,
      mentions,
      normalizedRouting.error,
      openCapabilityPicker,
      policy,
      prepareSubmit,
      retainMentions,
      selectedAgent,
      tagRequest,
    ],
  );

  return (
    <CapabilityComposerContext.Provider value={value}>
      {children}
    </CapabilityComposerContext.Provider>
  );
}

function useMentionEdits(
  setMentions: Dispatch<SetStateAction<CapabilityMention[]>>,
  hintsEnabled: boolean,
) {
  const addMention = useCallback(
    (mention: CapabilityMention) => {
      if (!hintsEnabled) return;
      setMentions((current) =>
        current.some((item) => item.key === mention.key)
          ? current
          : [...current, mention],
      );
    },
    [hintsEnabled, setMentions],
  );
  const retainMentions = useCallback(
    (keys: ReadonlySet<string>) =>
      setMentions((current) => current.filter((item) => keys.has(item.key))),
    [setMentions],
  );
  return { addMention, retainMentions };
}

/**
 * Puts the mentions' model hints on the composer's next send. An edit always
 * states its own (even none), so a tag removed while editing stays removed.
 */
function useHintRunConfig(
  policy: ExecutionPolicy,
  mentions: readonly CapabilityMention[],
  edit = false,
) {
  const composerRuntime = useComposerRuntime();
  useEffect(() => {
    const current = composerRuntime.getState().runConfig;
    const custom = { ...(current.custom ?? {}) };
    const payload =
      buildCapabilityHintPayload(policy, mentions) ??
      (edit && policy === "auto" ? { capabilities: [] } : undefined);
    if (payload) custom.aomiCapabilityHints = payload;
    else delete custom.aomiCapabilityHints;
    composerRuntime.setRunConfig({ ...current, custom });
  }, [composerRuntime, edit, policy, mentions]);
}

const noop = () => {};

/**
 * An edit box's own mentions under the thread composer's routing. The thread
 * composer's picker and tag requests stay with the thread composer.
 */
export function EditCapabilityComposerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const thread = useCapabilityComposer();
  const [mentions, setMentions] = useState<CapabilityMention[]>([]);
  const { addMention, retainMentions } = useMentionEdits(
    setMentions,
    thread.hintsEnabled,
  );
  useHintRunConfig(thread.policy, mentions, true);
  const value = useMemo<CapabilityComposerContextValue>(
    () => ({
      ...thread,
      mentions,
      addMention,
      retainMentions,
      capabilityPickerRequest: 0,
      tagRequest: null,
      consumeTagRequest: noop,
      openCapabilityPicker: noop,
      consumeCapabilityPickerRequest: noop,
    }),
    [addMention, mentions, retainMentions, thread],
  );
  return (
    <CapabilityComposerContext.Provider value={value}>
      {children}
    </CapabilityComposerContext.Provider>
  );
}
