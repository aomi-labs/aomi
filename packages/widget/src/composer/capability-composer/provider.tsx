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
  type FormEvent,
  type ReactNode,
} from "react";
import { useControl, useThreadContext } from "@aomi-labs/react";
import {
  normalizeAomiRouting,
  sameDirectRoutingApp,
  toAgentTarget,
  type AomiRoutingConfig,
  type DirectRoutingApp,
} from "../routing";
import { buildCapabilityHintPayload } from "../capability-hint-payload";
import type {
  AppTagRequest,
  CapabilityMention,
  ExecutionPolicy,
} from "./model";

type CapabilityComposerContextValue = {
  mentions: CapabilityMention[];
  policy: ExecutionPolicy;
  /** Explicit host tag or active Direct target; an Auto allowlist is not selection. */
  selectedApp: DirectRoutingApp | AppTagRequest | null;
  hintsEnabled: boolean;
  hostError: string | null;
  capabilityPickerRequest: number;
  /** Host app tag waiting for the input to insert it as a mention. */
  appTagRequest: AppTagRequest | null;
  consumeAppTagRequest: () => void;
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
  initialAppTag,
}: {
  children: ReactNode;
  enabledAppIds?: readonly string[];
  routing?: AomiRoutingConfig;
  initialAppTag?: AppTagRequest;
}) {
  const { onAgentModeSelect, onAgentTargetSelect } = useControl();
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
  // Routing is host-owned: a mode stored by an earlier mode picker (or the
  // device-wide preference) must not strand a chat outside the host default.
  const policy: ExecutionPolicy = normalizedRouting.defaultMode;
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
  const selectedApp =
    initialAppTag ?? (policy === "direct" ? selectedDirectApp : null);
  const [mentions, setMentions] = useState<CapabilityMention[]>([]);

  useEffect(
    () =>
      composerRuntime.unstable_on("send", () => {
        // The runtime has already captured this turn's runConfig.
        setMentions([]);
      }),
    [composerRuntime],
  );
  const [capabilityPickerRequest, setCapabilityPickerRequest] = useState(0);

  useEffect(() => {
    setMentions([]);
  }, [policy, threadContext.currentThreadId]);

  // Offer the host's app tag once, after the mount-time mention reset above.
  const [appTagRequest, setAppTagRequest] = useState<AppTagRequest | null>(
    null,
  );
  const appTagKey = initialAppTag
    ? `${initialAppTag.app}:${initialAppTag.applicationId ?? ""}`
    : "";
  const offeredAppTag = useRef("");
  useEffect(() => {
    if (!initialAppTag || offeredAppTag.current === appTagKey) return;
    offeredAppTag.current = appTagKey;
    setAppTagRequest(initialAppTag);
  }, [appTagKey, initialAppTag]);
  const consumeAppTagRequest = useCallback(() => setAppTagRequest(null), []);

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
      selectedApp,
      hintsEnabled,
      hostError: normalizedRouting.error,
      capabilityPickerRequest,
      appTagRequest,
      consumeAppTagRequest,
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
      appTagRequest,
      capabilityPickerRequest,
      consumeAppTagRequest,
      consumeCapabilityPickerRequest,
      enabledAppIds,
      hintsEnabled,
      mentions,
      normalizedRouting.error,
      openCapabilityPicker,
      policy,
      prepareSubmit,
      retainMentions,
      selectedApp,
    ],
  );

  return (
    <CapabilityComposerContext.Provider value={value}>
      {children}
    </CapabilityComposerContext.Provider>
  );
}
