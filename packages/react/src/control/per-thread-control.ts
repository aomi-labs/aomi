// =============================================================================
// usePerThreadControl — per-thread model & agent selection
// =============================================================================
//
// Each chat thread carries its own "control" metadata (model, modelMode, agent,
// controlDirty). This hook owns:
//   - Reading / writing that per-thread metadata.
//   - The auto-effect that fills in a missing model from stored preference
//     OR re-aligns "auto" threads to the latest available default.
//   - The two user-facing setters (onModelSelect, onAgentSelect).
//   - The pending-control state carried by the next Agent start.
//
// State that isn't per-thread (apiKey, available models, authorized agents)
// is read via refs — this hook depends on but doesn't own them.

import { createScopedStorage, type ScopedStorage } from "@aomi-labs/client";
import { useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import type { AgentTarget } from "@aomi-labs/client";
import type { AgentMode } from "../state/thread-store";
import {
  initThreadControl,
  type ThreadControlState,
  type ThreadMetadata,
  type ModelSelectionMode,
} from "../state/thread-store";
import { resolveAutoModel, resolveCatalogModel } from "./model-selection";

const defaultStorage = createScopedStorage({ backendUrl: "" });

const MODEL_SELECTION_STORAGE_KEY = "aomi_model_selection";
const AGENT_MODE_STORAGE_KEY = "aomi_agent_mode";

type StoredModelPreference = {
  mode: ModelSelectionMode;
  model: string | null;
};

type DirectAgentTarget = AgentTarget;
type AgentModeSelectionOptions = { persist?: boolean };

function readStoredAgentMode(storage: ScopedStorage): AgentMode {
  try {
    return storage.migrate("agentMode", AGENT_MODE_STORAGE_KEY) === "direct"
      ? "direct"
      : "auto";
  } catch {
    return "auto";
  }
}

function writeStoredAgentMode(storage: ScopedStorage, mode: AgentMode): void {
  try {
    storage.set("agentMode", mode);
  } catch {
    // localStorage not available
  }
}

function readStoredModelPreference(
  storage: ScopedStorage,
): StoredModelPreference {
  try {
    const raw = storage.migrate("modelSelection", MODEL_SELECTION_STORAGE_KEY);
    if (!raw) return { mode: "auto", model: null };
    const parsed = JSON.parse(raw) as Partial<StoredModelPreference>;
    return {
      mode: parsed.mode === "manual" ? "manual" : "auto",
      model: typeof parsed.model === "string" ? parsed.model : null,
    };
  } catch {
    return { mode: "auto", model: null };
  }
}

function writeStoredModelPreference(
  storage: ScopedStorage,
  preference: StoredModelPreference,
): void {
  try {
    storage.set("modelSelection", JSON.stringify(preference));
  } catch {
    // localStorage not available
  }
}

function resolvePreferredModelSelection(
  preference: StoredModelPreference,
  models: string[],
  defaultModel: string | null,
): StoredModelPreference {
  if (preference.mode === "manual") {
    const model = resolveCatalogModel(preference.model, models);
    if (model) return { mode: "manual", model };
  }
  if (preference.mode === "auto") {
    return {
      mode: "auto",
      model: resolveAutoModel(models) ?? defaultModel,
    };
  }
  return {
    mode: "auto",
    model: defaultModel ?? resolveAutoModel(models),
  };
}

function getFallbackModel(
  models: string[],
  defaultModel: string | null,
): string | null {
  return defaultModel ?? resolveAutoModel(models);
}

export type PerThreadControlActions = {
  getCurrentThreadControl: () => ThreadControlState;
  getCurrentThreadAgentMode: () => AgentMode;
  getCurrentThreadTarget: () => AgentTarget;
  getCurrentThreadAgent: () => string;
  getPreferredThreadControl: () => ThreadControlState;
  onModelSelect: (
    model: string,
    options?: { mode?: ModelSelectionMode },
  ) => Promise<void>;
  onAgentSelect: (agent: string) => void;
  onAgentTargetSelect: (
    target: DirectAgentTarget,
    options?: AgentModeSelectionOptions,
  ) => void;
  onAgentModeSelect: (
    mode: AgentMode,
    options?: AgentModeSelectionOptions,
  ) => void;
  markControlSynced: () => void;
};

type UsePerThreadControlOptions = {
  storage?: ScopedStorage;
  sessionIdRef: MutableRefObject<string>;
  getThreadMetadataRef: MutableRefObject<
    (threadId: string) => ThreadMetadata | undefined
  >;
  updateThreadMetadataRef: MutableRefObject<
    (threadId: string, partial: Partial<ThreadMetadata>) => void
  >;
  /** Reactive auth-endpoint state — the auto-model effect reads from these. */
  availableModels: string[];
  defaultModel: string | null;
  /** Refs for the same data, used by callbacks that fire outside render. */
  availableModelsRef: MutableRefObject<string[]>;
  defaultModelRef: MutableRefObject<string | null>;
  /** Current thread id (reactive — used to retrigger the auto-model effect). */
  sessionId: string;
};

/** Provider-internal: owns per-thread control wiring. Consumers should use
 *  the `usePerThreadControl` slice reader from contexts/control-context.tsx. */
export function usePerThreadControlImpl({
  storage = defaultStorage,
  sessionIdRef,
  getThreadMetadataRef,
  updateThreadMetadataRef,
  availableModels,
  defaultModel,
  availableModelsRef,
  defaultModelRef,
  sessionId,
}: UsePerThreadControlOptions): PerThreadControlActions {
  const getCurrentThreadControl = useCallback((): ThreadControlState => {
    const metadata = getThreadMetadataRef.current(sessionIdRef.current);
    return metadata?.control ?? initThreadControl();
  }, [storage]);

  const getPreferredThreadControl = useCallback((): ThreadControlState => {
    const preference = readStoredModelPreference(storage);
    const selection = resolvePreferredModelSelection(
      preference,
      availableModelsRef.current,
      defaultModelRef.current,
    );
    return {
      ...initThreadControl(),
      agentMode: readStoredAgentMode(storage),
      model: selection.model,
      modelMode: selection.mode,
      controlDirty: selection.model !== null,
    };
  }, [storage]);

  const getCurrentThreadAgent = useCallback(
    (): string => getCurrentThreadControl().agent ?? "aomi/main",
    [getCurrentThreadControl],
  );

  const getCurrentThreadAgentMode = useCallback(
    (): AgentMode => getCurrentThreadControl().agentMode ?? "auto",
    [getCurrentThreadControl],
  );

  const getCurrentThreadTarget = useCallback((): AgentTarget => {
    const agent = getCurrentThreadControl().agent;
    return getCurrentThreadAgentMode() === "direct" && agent ? { agent } : {};
  }, [getCurrentThreadAgentMode, getCurrentThreadControl]);

  const onAgentTargetSelect = useCallback(
    (target: DirectAgentTarget, options?: AgentModeSelectionOptions) => {
      const threadId = sessionIdRef.current;
      updateThreadMetadataRef.current(threadId, {
        control: {
          ...getCurrentThreadControl(),
          agentMode: "direct",
          agent: target.agent ?? "aomi/main",
          controlDirty: true,
        },
      });
      if (options?.persist !== false) writeStoredAgentMode(storage, "direct");
    },
    [storage, getCurrentThreadControl],
  );

  const onModelSelect = useCallback(
    async (model: string, options?: { mode?: ModelSelectionMode }) => {
      const threadId = sessionIdRef.current;
      const currentControl =
        getThreadMetadataRef.current(threadId)?.control ?? initThreadControl();
      const modelMode = options?.mode ?? "manual";
      const selectedModel =
        resolveCatalogModel(model, availableModelsRef.current) ?? model;

      updateThreadMetadataRef.current(threadId, {
        control: {
          ...currentControl,
          model: selectedModel,
          modelMode,
          controlDirty: true,
        },
      });

      // Agent start is the single session/turn mutation. Keep selection local
      // until the next send; the runtime passes it into ClientSession and
      // clears controlDirty only after that start succeeds.
      writeStoredModelPreference(storage, {
        mode: modelMode,
        model: modelMode === "manual" ? selectedModel : null,
      });
    },
    [storage],
  );

  const onAgentSelect = useCallback(
    (agent: string) => {
      onAgentTargetSelect({ agent });
    },
    [onAgentTargetSelect],
  );

  const onAgentModeSelect = useCallback(
    (agentMode: AgentMode, options?: AgentModeSelectionOptions) => {
      const threadId = sessionIdRef.current;
      const currentControl =
        getThreadMetadataRef.current(threadId)?.control ?? initThreadControl();
      updateThreadMetadataRef.current(threadId, {
        control: {
          ...currentControl,
          agentMode,
          controlDirty: true,
        },
      });
      if (options?.persist !== false) writeStoredAgentMode(storage, agentMode);
    },
    [storage],
  );

  const markControlSynced = useCallback(() => {
    const threadId = sessionIdRef.current;
    const currentControl =
      getThreadMetadataRef.current(threadId)?.control ?? initThreadControl();
    if (currentControl.controlDirty) {
      updateThreadMetadataRef.current(threadId, {
        control: { ...currentControl, controlDirty: false },
      });
    }
  }, [storage]);

  // Auto-effect: fill in a missing model from stored preference, or
  // re-align an "auto" thread to the latest available default after the
  // backend model list refreshes.
  useEffect(() => {
    const threadId = sessionIdRef.current;
    const metadata = getThreadMetadataRef.current(threadId);
    if (!metadata) return;

    const currentControl = metadata.control;
    const preference = readStoredModelPreference(storage);
    const preferredModel = resolveCatalogModel(
      preference.model,
      availableModels,
    );
    if (
      preference.mode === "manual" &&
      preferredModel &&
      preferredModel !== preference.model
    ) {
      writeStoredModelPreference(storage, {
        mode: "manual",
        model: preferredModel,
      });
    }
    const storedAgentMode = readStoredAgentMode(storage);
    let nextControl: ThreadControlState | null =
      !currentControl.agentMode && storedAgentMode === "direct"
        ? {
            ...currentControl,
            agentMode: storedAgentMode,
            controlDirty: true,
          }
        : null;
    const baseControl = nextControl ?? currentControl;

    if (currentControl.model === null) {
      const preferred = getPreferredThreadControl();
      if (preferred.model) {
        nextControl = {
          ...baseControl,
          model: preferred.model,
          modelMode: preferred.modelMode,
          controlDirty: true,
        };
      }
    } else if (availableModels.length > 0) {
      const currentMode = currentControl.modelMode ?? "manual";

      if (currentMode === "auto") {
        const autoModel = getFallbackModel(availableModels, defaultModel);
        if (autoModel && currentControl.model !== autoModel) {
          nextControl = {
            ...baseControl,
            model: autoModel,
            modelMode: "auto",
            controlDirty: true,
          };
        }
      } else {
        const catalogModel = resolveCatalogModel(
          currentControl.model,
          availableModels,
        );
        const model =
          catalogModel ?? getFallbackModel(availableModels, defaultModel);
        if (model && model !== currentControl.model) {
          nextControl = {
            ...baseControl,
            model,
            modelMode: catalogModel ? "manual" : "auto",
            controlDirty: true,
          };
        }
      }
    }

    if (!nextControl) return;
    updateThreadMetadataRef.current(threadId, { control: nextControl });
  }, [
    getPreferredThreadControl,
    sessionId,
    availableModels,
    defaultModel,
    storage,
  ]);

  return {
    getCurrentThreadControl,
    getCurrentThreadAgentMode,
    getCurrentThreadTarget,
    getCurrentThreadAgent,
    getPreferredThreadControl,
    onModelSelect,
    onAgentSelect,
    onAgentTargetSelect,
    onAgentModeSelect,
    markControlSynced,
  };
}
