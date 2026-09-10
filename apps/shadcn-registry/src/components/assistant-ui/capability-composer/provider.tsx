"use client";
import { useComposerRuntime } from "@assistant-ui/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useControl, useThreadContext } from "@aomi-labs/react";
import {
  normalizeAomiRouting,
  sameDirectRoutingApp,
  shouldShowDirectAppSelect,
  toAgentTarget,
  type AomiRoutingConfig,
  type DirectRoutingApp,
  type NormalizedAomiRouting,
} from "../routing";
import { buildCapabilityHintPayload } from "../capability-hint-payload";
import type { CapabilityMention, ExecutionPolicy } from "./model";

type CapabilityComposerContextValue = {
  mentions: CapabilityMention[];
  policy: ExecutionPolicy;
  routing: NormalizedAomiRouting;
  selectedDirectApp: DirectRoutingApp | null;
  showModeSelect: boolean;
  showDirectAppSelect: boolean;
  hintsEnabled: boolean;
  hostError: string | null;
  capabilityPickerRequest: number;
  setPolicy: (policy: ExecutionPolicy) => void;
  selectDirectApp: (target: DirectRoutingApp) => void;
  openCapabilityPicker: () => void;
  consumeCapabilityPickerRequest: () => void;
  addMention: (mention: CapabilityMention) => void;
  retainMentions: (keys: ReadonlySet<string>) => void;
  prepareSubmit: (event: FormEvent<HTMLFormElement>) => void;
  enabledAppIds?: readonly string[];
  allowAppMentions: boolean;
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
  enabledAppIds,
  routing,
}: {
  children: ReactNode;
  enabledAppIds?: readonly string[];
  routing?: AomiRoutingConfig;
}) {
  const { getAuthorizedApps, onAgentModeSelect, onAgentTargetSelect } =
    useControl();
  const threadContext = useThreadContext();
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
  const storedMode =
    currentControl?.agentMode ??
    (currentControl?.app || currentControl?.applicationId != null
      ? "direct"
      : undefined);
  const policy: ExecutionPolicy =
    storedMode && normalizedRouting.modes.includes(storedMode)
      ? storedMode
      : normalizedRouting.defaultMode;
  const currentDirectApp: DirectRoutingApp | null =
    currentControl?.applicationId != null &&
    Number.isSafeInteger(Number(currentControl.applicationId))
      ? {
          applicationId: Number(currentControl.applicationId),
          ...(currentControl.app ? { app: currentControl.app } : {}),
        }
      : currentControl?.app
        ? { app: currentControl.app }
        : null;
  const selectedDirectApp =
    (currentDirectApp
      ? normalizedRouting.directApps.find((candidate) =>
          sameDirectRoutingApp(candidate, currentDirectApp),
        )
      : undefined) ??
    normalizedRouting.directApps[0] ??
    null;
  const [mentions, setMentions] = useState<CapabilityMention[]>([]);
  const [capabilityPickerRequest, setCapabilityPickerRequest] = useState(0);

  useEffect(() => {
    void getAuthorizedApps();
  }, [getAuthorizedApps]);

  useEffect(() => {
    setMentions([]);
  }, [policy, threadContext.threadViewKey]);

  useEffect(() => {
    if (normalizedRouting.error) return;
    if (policy === "auto") {
      if (storedMode && storedMode !== "auto") {
        onAgentModeSelect("auto", { persist: false });
      }
      return;
    }
    if (
      selectedDirectApp &&
      (storedMode !== "direct" ||
        !currentDirectApp ||
        !sameDirectRoutingApp(selectedDirectApp, currentDirectApp))
    ) {
      onAgentTargetSelect(toAgentTarget(selectedDirectApp), { persist: false });
    }
  }, [
    currentDirectApp,
    normalizedRouting,
    onAgentModeSelect,
    onAgentTargetSelect,
    policy,
    selectedDirectApp,
    storedMode,
  ]);

  const selectDirectApp = useCallback(
    (target: DirectRoutingApp) => {
      if (
        !normalizedRouting.directApps.some((candidate) =>
          sameDirectRoutingApp(candidate, target),
        )
      ) {
        return;
      }
      setMentions([]);
      onAgentTargetSelect(toAgentTarget(target));
    },
    [normalizedRouting.directApps, onAgentTargetSelect],
  );

  const setPolicy = useCallback(
    (nextPolicy: ExecutionPolicy) => {
      if (!normalizedRouting.modes.includes(nextPolicy)) return;
      setMentions([]);
      if (nextPolicy === "auto") {
        onAgentModeSelect("auto");
        return;
      }
      const target = selectedDirectApp ?? normalizedRouting.directApps[0];
      if (target) {
        onAgentTargetSelect(toAgentTarget(target));
      }
    },
    [
      normalizedRouting.directApps,
      normalizedRouting.modes,
      onAgentModeSelect,
      onAgentTargetSelect,
      selectedDirectApp,
    ],
  );

  const hintsEnabled = policy === "auto";

  const openCapabilityPicker = useCallback(() => {
    if (!hintsEnabled) return;
    setCapabilityPickerRequest((request) => request + 1);
  }, [hintsEnabled]);
  const consumeCapabilityPickerRequest = useCallback(() => {
    setCapabilityPickerRequest(0);
  }, []);

  const addMention = useCallback(
    (mention: CapabilityMention) => {
      if (!hintsEnabled) return;
      setMentions((current) =>
        current.some((item) => item.key === mention.key)
          ? current
          : [...current, mention],
      );
    },
    [hintsEnabled],
  );

  const retainMentions = useCallback((keys: ReadonlySet<string>) => {
    setMentions((current) => current.filter((item) => keys.has(item.key)));
  }, []);

  useEffect(() => {
    const current = composerRuntime.getState().runConfig;
    const custom = { ...(current.custom ?? {}) };
    const payload = buildCapabilityHintPayload(policy, mentions);
    if (payload) custom.aomiCapabilityHints = payload;
    else delete custom.aomiCapabilityHints;
    composerRuntime.setRunConfig({ ...current, custom });
  }, [composerRuntime, policy, mentions]);

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
      routing: normalizedRouting,
      selectedDirectApp,
      showModeSelect: normalizedRouting.modes.length > 1,
      showDirectAppSelect: shouldShowDirectAppSelect(policy, normalizedRouting),
      hintsEnabled,
      hostError: normalizedRouting.error,
      capabilityPickerRequest,
      setPolicy,
      selectDirectApp,
      openCapabilityPicker,
      consumeCapabilityPickerRequest,
      addMention,
      retainMentions,
      prepareSubmit,
      enabledAppIds,
      allowAppMentions: hintsEnabled,
    }),
    [
      addMention,
      capabilityPickerRequest,
      consumeCapabilityPickerRequest,
      enabledAppIds,
      hintsEnabled,
      mentions,
      normalizedRouting,
      openCapabilityPicker,
      policy,
      prepareSubmit,
      retainMentions,
      selectDirectApp,
      selectedDirectApp,
      setPolicy,
    ],
  );

  return (
    <CapabilityComposerContext.Provider value={value}>
      {children}
    </CapabilityComposerContext.Provider>
  );
}
