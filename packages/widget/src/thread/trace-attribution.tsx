"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useControl } from "@aomi-labs/react";
import { useSkillCatalog } from "../../lib/capabilities/skill-catalog";
import type { TraceAttribution } from "./tool-interpreter/attribution";

export const TraceAttributionContext = createContext<TraceAttribution>({});
export const useTraceAttribution = () => useContext(TraceAttributionContext);

/** One catalog subscription for the entire transcript, including child agents. */
export function TraceAttributionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { state } = useControl();
  const { skills } = useSkillCatalog();
  const value = useMemo(
    () => ({ apps: state.appDescriptors, skills: skills ?? [] }),
    [state.appDescriptors, skills],
  );
  return (
    <TraceAttributionContext.Provider value={value}>
      {children}
    </TraceAttributionContext.Provider>
  );
}
