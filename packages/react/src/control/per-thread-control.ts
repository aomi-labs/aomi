// =============================================================================
// usePerThreadControl — per-thread model & app selection
// =============================================================================
//
// Each chat thread carries its own "control" metadata (model, modelMode, app,
// controlDirty). This hook owns:
//   - Reading / writing that per-thread metadata.
//   - The auto-effect that fills in a missing model from stored preference
//     OR re-aligns "auto" threads to the latest available default.
//   - The two user-facing setters (onModelSelect, onAppSelect).
//   - The pending-control state carried by the next canonical Agent start.
//
// State that isn't per-thread (apiKey, available models, authorized apps)
// is read via refs — this hook depends on but doesn't own them.

import { useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import type { AomiAppDescriptor, ApplicationId } from "@aomi-labs/client";
import {
  initThreadControl,
  type ThreadControlState,
  type ThreadMetadata,
  type ModelSelectionMode,
} from "../state/thread-store";
import { resolveAutoModel } from "../utils/model-selection";

const MODEL_SELECTION_STORAGE_KEY = "aomi_model_selection";

type StoredModelPreference = {
  mode: ModelSelectionMode;
  model: string | null;
};

type AppSelectionOptions = {
  applicationId?: ApplicationId;
};

function readStoredModelPreference(): StoredModelPreference {
  try {
    const raw = globalThis.localStorage?.getItem(MODEL_SELECTION_STORAGE_KEY);
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

function writeStoredModelPreference(preference: StoredModelPreference): void {
  try {
    globalThis.localStorage?.setItem(
      MODEL_SELECTION_STORAGE_KEY,
      JSON.stringify(preference),
    );
  } catch {
    // localStorage not available
  }
}

function resolvePreferredModelSelection(
  preference: StoredModelPreference,
  models: string[],
  defaultModel: string | null,
): StoredModelPreference {
  if (
    preference.mode === "manual" &&
    preference.model &&
    models.includes(preference.model)
  ) {
    return preference;
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

function normalizeApplicationId(value: unknown): ApplicationId {
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function sameApplicationId(left: unknown, right: unknown): boolean {
  return (
    normalizeApplicationId(left)?.toString() ===
    normalizeApplicationId(right)?.toString()
  );
}

function findAuthorizedDescriptor(
  app: string,
  applicationId: ApplicationId,
  descriptors: AomiAppDescriptor[],
): AomiAppDescriptor | null {
  const scopedId = normalizeApplicationId(applicationId);
  if (scopedId !== null) {
    return (
      descriptors.find(
        (descriptor) =>
          descriptor.name === app &&
          sameApplicationId(descriptor.applicationId, scopedId),
      ) ?? null
    );
  }
  return (
    descriptors.find(
      (descriptor) =>
        descriptor.name === app &&
        normalizeApplicationId(descriptor.applicationId) === null,
    ) ?? null
  );
}

function resolveAuthorizedApp(
  app: string | null | undefined,
  applicationId: ApplicationId,
  authorizedApps: string[],
  appDescriptors: AomiAppDescriptor[],
  defaultApp: string | null,
): AomiAppDescriptor | null {
  if (app) {
    const scopedId = normalizeApplicationId(applicationId);
    const exact = findAuthorizedDescriptor(app, applicationId, appDescriptors);
    if (exact) return exact;
    const nameRequiresApplicationId = appDescriptors.some(
      (descriptor) =>
        descriptor.name === app &&
        normalizeApplicationId(descriptor.applicationId) !== null,
    );
    if (
      scopedId === null &&
      !nameRequiresApplicationId &&
      authorizedApps.includes(app)
    ) {
      return { name: app, applicationId: null };
    }
  }
  if (!defaultApp) return null;
  return (
    findAuthorizedDescriptor(defaultApp, null, appDescriptors) ?? {
      name: defaultApp,
    }
  );
}

export type PerThreadControlActions = {
  getCurrentThreadControl: () => ThreadControlState;
  getCurrentThreadApp: () => string;
  getCurrentThreadApplicationId: () => ApplicationId;
  getPreferredThreadControl: () => ThreadControlState;
  onModelSelect: (
    model: string,
    options?: { mode?: ModelSelectionMode },
  ) => Promise<void>;
  onAppSelect: (app: string, options?: AppSelectionOptions) => void;
  markControlSynced: () => void;
};

type UsePerThreadControlOptions = {
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
  authorizedAppsRef: MutableRefObject<string[]>;
  appDescriptorsRef: MutableRefObject<AomiAppDescriptor[]>;
  defaultAppRef: MutableRefObject<string | null>;
  /** Current thread id (reactive — used to retrigger the auto-model effect). */
  sessionId: string;
};

/** Provider-internal: owns per-thread control wiring. Consumers should use
 *  the `usePerThreadControl` slice reader from contexts/control-context.tsx. */
export function usePerThreadControlImpl({
  sessionIdRef,
  getThreadMetadataRef,
  updateThreadMetadataRef,
  availableModels,
  defaultModel,
  availableModelsRef,
  defaultModelRef,
  authorizedAppsRef,
  appDescriptorsRef,
  defaultAppRef,
  sessionId,
}: UsePerThreadControlOptions): PerThreadControlActions {

  const getCurrentThreadControl = useCallback((): ThreadControlState => {
    const metadata = getThreadMetadataRef.current(sessionIdRef.current);
    return metadata?.control ?? initThreadControl();
  }, []);

  const getPreferredThreadControl = useCallback((): ThreadControlState => {
    const preference = readStoredModelPreference();
    const selection = resolvePreferredModelSelection(
      preference,
      availableModelsRef.current,
      defaultModelRef.current,
    );
    return {
      ...initThreadControl(),
      model: selection.model,
      modelMode: selection.mode,
      controlDirty: selection.model !== null,
    };
  }, []);

  const getCurrentThreadApp = useCallback((): string => {
    const currentControl =
      getThreadMetadataRef.current(sessionIdRef.current)?.control ??
      initThreadControl();
    return (
      resolveAuthorizedApp(
        currentControl.app,
        currentControl.applicationId,
        authorizedAppsRef.current,
        appDescriptorsRef.current,
        defaultAppRef.current,
      )?.name ?? "default"
    );
  }, []);

  const getCurrentThreadApplicationId = useCallback((): ApplicationId => {
    const currentControl =
      getThreadMetadataRef.current(sessionIdRef.current)?.control ??
      initThreadControl();
    return (
      resolveAuthorizedApp(
        currentControl.app,
        currentControl.applicationId,
        authorizedAppsRef.current,
        appDescriptorsRef.current,
        defaultAppRef.current,
      )?.applicationId ?? null
    );
  }, []);

  const onModelSelect = useCallback(
    async (model: string, options?: { mode?: ModelSelectionMode }) => {
      const threadId = sessionIdRef.current;
      const currentControl =
        getThreadMetadataRef.current(threadId)?.control ?? initThreadControl();
      const modelMode = options?.mode ?? "manual";
      const selectedApp = resolveAuthorizedApp(
        currentControl.app,
        currentControl.applicationId,
        authorizedAppsRef.current,
        appDescriptorsRef.current,
        defaultAppRef.current,
      ) ?? { name: "default" };

      updateThreadMetadataRef.current(threadId, {
        control: {
          ...currentControl,
          model,
          modelMode,
          app: selectedApp.name,
          applicationId: normalizeApplicationId(selectedApp.applicationId),
          controlDirty: true,
        },
      });

      // Agent start is the single session/turn mutation. Keep selection local
      // until the next send; the runtime passes it into ClientSession and
      // clears controlDirty only after that start succeeds.
      writeStoredModelPreference({
        mode: modelMode,
        model: modelMode === "manual" ? model : null,
      });
    },
    [],
  );

  const onAppSelect = useCallback(
    (app: string, options?: AppSelectionOptions) => {
      const threadId = sessionIdRef.current;
      const currentControl =
        getThreadMetadataRef.current(threadId)?.control ?? initThreadControl();
      const descriptor = resolveAuthorizedApp(
        app,
        options?.applicationId ?? null,
        authorizedAppsRef.current,
        appDescriptorsRef.current,
        null,
      );
      const hasAuthData =
        authorizedAppsRef.current.length > 0 ||
        appDescriptorsRef.current.length > 0;
      if (hasAuthData && !descriptor) {
        console.warn("[per-thread-control] Cannot select unauthorized app", {
          app,
        });
        return;
      }
      updateThreadMetadataRef.current(threadId, {
        control: {
          ...currentControl,
          app: descriptor?.name ?? app,
          applicationId: normalizeApplicationId(
            options?.applicationId ?? descriptor?.applicationId ?? null,
          ),
          controlDirty: true,
        },
      });
    },
    [],
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
  }, []);

  // Auto-effect: fill in a missing model from stored preference, or
  // re-align an "auto" thread to the latest available default after the
  // backend model list refreshes.
  useEffect(() => {
    const threadId = sessionIdRef.current;
    const metadata = getThreadMetadataRef.current(threadId);
    if (!metadata) return;

    const currentControl = metadata.control;
    let nextControl: ThreadControlState | null = null;

    if (currentControl.model === null) {
      const preferred = getPreferredThreadControl();
      if (!preferred.model) return;
      nextControl = {
        ...currentControl,
        model: preferred.model,
        modelMode: preferred.modelMode,
        controlDirty: true,
      };
    } else if (availableModels.length > 0) {
      const currentMode = currentControl.modelMode ?? "manual";

      if (currentMode === "auto") {
        const autoModel = getFallbackModel(availableModels, defaultModel);
        if (autoModel && currentControl.model !== autoModel) {
          nextControl = {
            ...currentControl,
            model: autoModel,
            modelMode: "auto",
            controlDirty: true,
          };
        }
      } else if (!availableModels.includes(currentControl.model)) {
        const fallbackModel = getFallbackModel(availableModels, defaultModel);
        if (fallbackModel) {
          nextControl = {
            ...currentControl,
            model: fallbackModel,
            modelMode: "auto",
            controlDirty: true,
          };
        }
      }
    }

    if (!nextControl) return;
    updateThreadMetadataRef.current(threadId, { control: nextControl });
  }, [getPreferredThreadControl, sessionId, availableModels, defaultModel]);

  return {
    getCurrentThreadControl,
    getCurrentThreadApp,
    getCurrentThreadApplicationId,
    getPreferredThreadControl,
    onModelSelect,
    onAppSelect,
    markControlSynced,
  };
}
