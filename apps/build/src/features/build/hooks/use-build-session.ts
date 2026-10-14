"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  STREAM_TO_JOURNEY,
  defaultStreamTemplate,
  deriveGeneratedFileTree,
  deriveSmithersNodes,
  mockBuildResponse,
  type BuildFileNode,
  type BuildMessage,
  type BuildSession,
  type BuildStreamEvent,
  type JourneyStageId,
  type SmithersNode,
} from "@/features/build/contracts";
import {
  emptySessions,
  findSessionById,
  loadPersistedSessions,
  mergeSessions,
  savePersistedSession,
  subscribeBuildSessions,
} from "@/features/build/storage/build-session-storage";
import { sanitizeBuildSession } from "@/features/build/storage/sanitize-session-copy";
import {
  deriveSessionTitle,
  uniqueSessionTitle,
} from "@/features/build/storage/session-title";
import type { BuildRunSnapshot } from "@/features/build/run-contracts";
import {
  completionMessage,
  flagsFromSnapshot,
  nodesFromSnapshot,
  streamEventsFromSnapshot,
} from "@/features/build/smither-run-mapper";

/** When set, Create runs a real aomi-smither build through the BFF instead of
 *  the local mock pipeline. */
const ENGINE_MODE = process.env.NEXT_PUBLIC_BUILD_ENGINE === "smither";

/** Whether the page is driving the real engine (exported for view wiring,
 *  e.g. the download button targets the crate tarball route). */
export const BUILD_ENGINE_ACTIVE = ENGINE_MODE;

const RUN_POLL_MS = 2000;

function nowTime() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function nowStamp() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

const stageMessages: Record<BuildStreamEvent["stage"], string> = {
  plan: "Reading your intent and drafting a build plan.",
  generate: "Generating project files and tool wiring.",
  validate: "Ready for compile and smoke test.",
  ready: "Waiting for compile + smoke test before ship.",
};

/**
 * Local Create-session driver with timer pipeline + P3 verify gates.
 */
export function useBuildSession() {
  const persistedSessions = useSyncExternalStore(
    subscribeBuildSessions,
    loadPersistedSessions,
    () => emptySessions,
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [engineRunId, setEngineRunId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<JourneyStageId>("describe");
  const [messages, setMessages] = useState<BuildMessage[]>([]);
  const [streamEvents, setStreamEvents] = useState<BuildStreamEvent[]>([]);
  const [fileTree, setFileTree] = useState<BuildFileNode[]>([]);
  const [nodes, setNodes] = useState<SmithersNode[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null,
  );
  const [awaitingVerify, setAwaitingVerify] = useState(false);
  const [compileDone, setCompileDone] = useState(false);
  const [testDone, setTestDone] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState<"compile" | "test" | null>(null);
  const [shipReady, setShipReady] = useState(false);
  const [showStreamInThread, setShowStreamInThread] = useState(false);
  const timersRef = useRef<number[]>([]);
  const pollRef = useRef<number | null>(null);
  const pollEpochRef = useRef(0);
  const sessionDraftRef = useRef<{
    id: string;
    title: string;
    messages: BuildMessage[];
    streamEvents: BuildStreamEvent[];
    fileTree: BuildFileNode[];
    nodes: SmithersNode[];
  } | null>(null);

  const recentSessions = mergeSessions(persistedSessions);

  const clearTimers = useCallback(() => {
    pollEpochRef.current += 1;
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /** Fold a run snapshot into view state + the session draft. Stops the poll
   *  loop and persists the session once the run settles. */
  const applyRunSnapshot = useCallback(
    (
      snapshot: BuildRunSnapshot,
      onAssistantReady?: (msg: BuildMessage) => void,
    ): boolean => {
      const draft = sessionDraftRef.current;
      if (!draft) return false;
      const nodes = nodesFromSnapshot(snapshot);
      const streamEvents = streamEventsFromSnapshot(snapshot);
      const flags = flagsFromSnapshot(snapshot);
      const fileTree = snapshot.fileTree as BuildFileNode[];
      setNodes(nodes);
      setStreamEvents(streamEvents);
      setFileTree(fileTree);
      setCompileDone(flags.compileDone);
      setTestDone(flags.testDone);
      const active = streamEvents.find((e) => e.status === "active");
      if (active) setStageId(STREAM_TO_JOURNEY[active.stage]);
      draft.nodes = nodes;
      draft.streamEvents = streamEvents;
      draft.fileTree = fileTree;

      const settled =
        snapshot.status === "completed" || snapshot.status === "failed";
      if (!settled) return false;
      setIsGenerating(false);
      setShipReady(flags.shipReady);
      if (flags.shipReady) setStageId("ship");
      const assistantMsg: BuildMessage = {
        id: `a_${Date.now()}`,
        role: "assistant",
        content: completionMessage(snapshot),
        timestamp: nowTime(),
        model: "Aomi",
      };
      setMessages((prev) => {
        const next = [...prev, assistantMsg];
        draft.messages = next;
        return next;
      });
      onAssistantReady?.(assistantMsg);
      savePersistedSession({
        id: draft.id,
        title: draft.title,
        status: flags.failed ? "failed" : "healthy",
        model: "Aomi",
        updatedAt: "just now",
        runtime: snapshot.app,
        runId: snapshot.runId,
        app: snapshot.app,
        stageId: flags.shipReady ? "ship" : "generate",
        messages: [...draft.messages],
        streamEvents,
        fileTree,
        nodes,
      });
      return true;
    },
    [],
  );

  /** Start (or restart) the poll loop for a run; it stops itself on settle. */
  const beginRunPolling = useCallback(
    (runId: string, onAssistantReady?: (msg: BuildMessage) => void) => {
      clearTimers();
      const pollEpoch = pollEpochRef.current;
      const schedule = () => {
        if (pollEpochRef.current !== pollEpoch) return;
        pollRef.current = window.setTimeout(() => {
          pollRef.current = null;
          void poll();
        }, RUN_POLL_MS);
      };
      const poll = async () => {
        if (pollEpochRef.current !== pollEpoch) return;
        if (document.hidden) {
          schedule();
          return;
        }
        let settled = false;
        try {
          const res = await fetch(
            `/api/bff/build/runs?id=${encodeURIComponent(runId)}`,
          );
          if (res.ok && pollEpochRef.current === pollEpoch) {
            settled = applyRunSnapshot(
              (await res.json()) as BuildRunSnapshot,
              onAssistantReady,
            );
          }
        } catch {
          // A later poll can recover from a transient network interruption.
        } finally {
          if (settled) {
            pollEpochRef.current += 1;
          } else {
            schedule();
          }
        }
      };
      void poll();
    },
    [applyRunSnapshot, clearTimers],
  );

  const loadSession = useCallback(
    (sessionId: string) => {
      clearTimers();
      const session = findSessionById(sessionId, persistedSessions);
      if (!session) return;
      const clean = sanitizeBuildSession(session);
      const healthy = clean.status === "healthy" && clean.stageId === "ship";
      const needsVerify =
        !healthy &&
        (clean.stageId === "compile_test" ||
          clean.status === "running");
      let streamEvents = clean.streamEvents;
      if (needsVerify && streamEvents.length > 0) {
        // Persisted mid-verify runs may wrongly mark Ship done — coerce.
        streamEvents = streamEvents.map((e) => {
          if (e.stage === "plan" || e.stage === "generate") {
            return { ...e, status: "done" as const };
          }
          if (e.stage === "validate") {
            return {
              ...e,
              status: "active" as const,
              message: e.message || "Ready for compile and smoke test.",
            };
          }
          return {
            ...e,
            status: "pending" as const,
            message: e.message || "Waiting for compile + smoke test before ship.",
          };
        });
      }
      setActiveSessionId(sessionId);
      setEngineRunId(clean.runId ?? null);
      setStageId(healthy ? "ship" : needsVerify ? "compile_test" : clean.stageId);
      setMessages(clean.messages);
      setStreamEvents(streamEvents);
      setFileTree(clean.fileTree);
      setNodes(clean.nodes ?? []);
      setShipReady(healthy);
      setAwaitingVerify(needsVerify);
      setCompileDone(healthy);
      setTestDone(healthy);
      setVerifyBusy(null);
      setShowStreamInThread(false);
      setIsGenerating(false);
      setStreamingMessageId(null);
      sessionDraftRef.current = {
        id: clean.id,
        title: clean.title,
        messages: clean.messages,
        streamEvents,
        fileTree: clean.fileTree,
        nodes: clean.nodes ?? [],
      };
      // A reload mid-build reattaches to the live run instead of freezing on
      // the last persisted frame.
      if (ENGINE_MODE && clean.runId && clean.status === "running") {
        setIsGenerating(true);
        setShowStreamInThread(true);
        setAwaitingVerify(false);
        beginRunPolling(clean.runId);
      }
    },
    [beginRunPolling, clearTimers, persistedSessions],
  );

  const startNewSession = useCallback(() => {
    clearTimers();
    sessionDraftRef.current = null;
    setActiveSessionId(null);
    setEngineRunId(null);
    setStageId("describe");
    setMessages([]);
    setStreamEvents([]);
    setFileTree([]);
    setNodes([]);
    setShipReady(false);
    setAwaitingVerify(false);
    setCompileDone(false);
    setTestDone(false);
    setVerifyBusy(null);
    setShowStreamInThread(false);
    setIsGenerating(false);
    setStreamingMessageId(null);
  }, [clearTimers]);

  const cancelPipeline = useCallback(() => {
    clearTimers();
    // Real runs: ask the engine to wind the run down (durable store write);
    // polling has already stopped via clearTimers.
    if (ENGINE_MODE && engineRunId) {
      void fetch("/api/bff/build/runs/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: engineRunId }),
      }).catch(() => {});
    }
    setIsGenerating(false);
    setStreamingMessageId(null);
    setVerifyBusy(null);
    setShowStreamInThread(true);
    setStreamEvents((prev) =>
      prev.map((e) =>
        e.status === "active" ? { ...e, status: "pending" as const } : e,
      ),
    );
    setMessages((prev) => {
      const next: BuildMessage[] = [
        ...prev,
        {
          id: `sys_cancel_${Date.now()}`,
          role: "system",
          content:
            "Stopped. Edit your prompt and run again, or continue compile / smoke test if files already exist.",
          timestamp: nowTime(),
        },
      ];
      if (sessionDraftRef.current) {
        sessionDraftRef.current.messages = next;
      }
      return next;
    });
    if (fileTree.length > 0) {
      setAwaitingVerify(true);
      setStageId("compile_test");
    }
  }, [clearTimers, engineRunId, fileTree.length]);

  /**
   * Real-engine driver: create a run through the BFF and poll its snapshot
   * into the same view state the mock pipeline writes. Compile/smoke run
   * inside the workflow, so the manual verify gates stay closed here.
   */
  const runEnginePipeline = useCallback(
    (userText: string, onAssistantReady: (msg: BuildMessage) => void) => {
      clearTimers();
      const sessionId = `run_${Date.now()}`;
      const title =
        uniqueSessionTitle(
          deriveSessionTitle(userText),
          recentSessions.map((s) => s.title),
        ) || "New build";
      const userMsg: BuildMessage = {
        id: `u_${Date.now()}`,
        role: "user",
        content: userText,
        timestamp: nowTime(),
      };

      setActiveSessionId(sessionId);
      setEngineRunId(null);
      setStageId("plan");
      setMessages([userMsg]);
      setIsGenerating(true);
      setShowStreamInThread(true);
      setShipReady(false);
      setAwaitingVerify(false);
      setCompileDone(false);
      setTestDone(false);
      setVerifyBusy(null);
      setNodes([]);
      setFileTree([]);
      const initial = defaultStreamTemplate.map((e) => ({ ...e }));
      setStreamEvents(initial);
      sessionDraftRef.current = {
        id: sessionId,
        title,
        messages: [userMsg],
        streamEvents: initial,
        fileTree: [],
        nodes: [],
      };

      const fail = (detail: string) => {
        setIsGenerating(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `sys_fail_${Date.now()}`,
            role: "system",
            content: `Could not run the build: ${detail}`,
            timestamp: nowTime(),
          },
        ]);
      };

      void (async () => {
        try {
          const res = await fetch("/api/bff/build/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: userText }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            fail(body.error ?? `request failed (${res.status})`);
            return;
          }
          const created = (await res.json()) as { runId: string; app: string };
          setEngineRunId(created.runId);
          // Persist immediately so a reload mid-build can reattach.
          savePersistedSession({
            id: sessionId,
            title,
            status: "running",
            model: "Aomi",
            updatedAt: "just now",
            runtime: created.app,
            runId: created.runId,
            app: created.app,
            stageId: "plan",
            messages: [userMsg],
            streamEvents: initial,
            fileTree: [],
            nodes: [],
          });
          beginRunPolling(created.runId, onAssistantReady);
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [beginRunPolling, clearTimers, recentSessions],
  );

  const runBuildPipeline = useCallback(
    (userText: string, onAssistantReady: (msg: BuildMessage) => void) => {
      if (ENGINE_MODE) {
        runEnginePipeline(userText, onAssistantReady);
        return;
      }
      clearTimers();
      const sessionId = `run_${Date.now()}`;
      const title = uniqueSessionTitle(
        deriveSessionTitle(userText),
        recentSessions.map((s) => s.title),
      );
      const userMsg: BuildMessage = {
        id: `u_${Date.now()}`,
        role: "user",
        content: userText,
        timestamp: nowTime(),
      };
      const plannedNodes = deriveSmithersNodes(userText);

      setActiveSessionId(sessionId);
      setStageId("describe");
      setMessages([userMsg]);
      setIsGenerating(true);
      setShowStreamInThread(true);
      setShipReady(false);
      setAwaitingVerify(false);
      setCompileDone(false);
      setTestDone(false);
      setVerifyBusy(null);
      setNodes(plannedNodes.map((n) => ({ ...n, status: "pending" })));

      const initial = defaultStreamTemplate.map((e) => ({ ...e }));
      setStreamEvents(initial);
      setFileTree([]);

      sessionDraftRef.current = {
        id: sessionId,
        title: title || "New build",
        messages: [userMsg],
        streamEvents: initial,
        fileTree: [],
        nodes: plannedNodes,
      };

      const stages: BuildStreamEvent["stage"][] = ["plan", "generate"];

      let finalMessages: BuildMessage[] = [userMsg];
      let finalStreamEvents = initial;
      let finalFileTree: BuildFileNode[] = [];
      let finalNodes = plannedNodes;

      stages.forEach((stage, index) => {
        const timerId = window.setTimeout(() => {
          setStageId(STREAM_TO_JOURNEY[stage]);

          setStreamEvents((prev) => {
            const next = prev.map((e) => {
              if (e.stage === stage) {
                return {
                  ...e,
                  status: "active" as const,
                  time: nowStamp(),
                  message: stageMessages[stage],
                };
              }
              if (stages.indexOf(e.stage) < index && e.status !== "done") {
                return {
                  ...e,
                  status: "done" as const,
                  time: e.time || nowStamp(),
                };
              }
              return e;
            });
            finalStreamEvents = next;
            if (sessionDraftRef.current) {
              sessionDraftRef.current.streamEvents = next;
            }
            return next;
          });

          if (stage === "plan") {
            finalNodes = plannedNodes.map((n, i) => ({
              ...n,
              status: i === 0 ? "active" : "pending",
            }));
            setNodes(finalNodes);
            const activateRest = window.setTimeout(() => {
              finalNodes = plannedNodes.map((n) => ({
                ...n,
                status: n.id === "node_run" ? "pending" : "done",
              }));
              setNodes(finalNodes);
              if (sessionDraftRef.current) {
                sessionDraftRef.current.nodes = finalNodes;
              }
            }, 500);
            timersRef.current.push(activateRest);
          }

          if (stage === "generate") {
            const tree = deriveGeneratedFileTree(userText);
            setFileTree(tree);
            finalFileTree = tree;
            if (sessionDraftRef.current) {
              sessionDraftRef.current.fileTree = finalFileTree;
            }

            // End of generate → enter verify gates (do not mark Ship done).
            setStreamEvents((prev) => {
              finalStreamEvents = prev.map((e) => {
                if (e.stage === "plan" || e.stage === "generate") {
                  return {
                    ...e,
                    status: "done" as const,
                    time: e.time || nowStamp(),
                  };
                }
                if (e.stage === "validate") {
                  return {
                    ...e,
                    status: "active" as const,
                    time: nowStamp(),
                    message: stageMessages.validate,
                  };
                }
                return {
                  ...e,
                  status: "pending" as const,
                  message: stageMessages.ready,
                };
              });
              if (sessionDraftRef.current) {
                sessionDraftRef.current.streamEvents = finalStreamEvents;
              }
              return finalStreamEvents;
            });
            setStageId("compile_test");
            setAwaitingVerify(true);
            setIsGenerating(false);

            const assistantMsg: BuildMessage = {
              id: `a_${Date.now()}`,
              role: "assistant",
              content: mockBuildResponse,
              timestamp: nowTime(),
              model: "Aomi",
            };
            finalMessages = [...finalMessages, assistantMsg];
            setMessages(finalMessages);
            if (sessionDraftRef.current) {
              sessionDraftRef.current.messages = finalMessages;
            }
            onAssistantReady(assistantMsg);

            savePersistedSession({
              id: sessionId,
              title: title || "New build",
              status: "running",
              model: "Aomi",
              updatedAt: "just now",
              runtime: "local",
              stageId: "compile_test",
              messages: finalMessages,
              streamEvents: finalStreamEvents,
              fileTree:
                finalFileTree.length > 0
                  ? finalFileTree
                  : deriveGeneratedFileTree(userText),
              nodes: finalNodes,
            });
          }
        }, (index + 1) * 700);
        timersRef.current.push(timerId);
      });
    },
    [clearTimers, recentSessions, runEnginePipeline],
  );

  const handleStreamComplete = useCallback(() => {
    setIsGenerating(false);
    setStreamingMessageId(null);
    setShowStreamInThread(false);
  }, []);

  const runCompile = useCallback(() => {
    // Real runs compile inside the workflow; the manual gate is mock-only.
    if (ENGINE_MODE || compileDone || verifyBusy) return;
    setVerifyBusy("compile");
    setStageId("compile_test");
    const id = window.setTimeout(() => {
      setCompileDone(true);
      setVerifyBusy(null);
      setNodes((prev) =>
        prev.map((n) =>
          n.id === "node_run" ? n : { ...n, status: "done" as const },
        ),
      );
      setStreamEvents((prev) => {
        const next = prev.map((e) => {
          if (e.stage === "validate") {
            return {
              ...e,
              status: "active" as const,
              message: "Compile done — smoke test next.",
              time: e.time || nowStamp(),
            };
          }
          if (e.stage === "ready") {
            return {
              ...e,
              status: "pending" as const,
              message: "Ship after smoke test passes.",
            };
          }
          return e.stage === "plan" || e.stage === "generate"
            ? { ...e, status: "done" as const }
            : e;
        });
        if (sessionDraftRef.current) {
          sessionDraftRef.current.streamEvents = next;
        }
        return next;
      });
    }, 600);
    timersRef.current.push(id);
  }, [compileDone, verifyBusy]);

  const runTest = useCallback(() => {
    if (ENGINE_MODE || !compileDone || testDone || verifyBusy) return;
    setVerifyBusy("test");
    setStageId("compile_test");
    setNodes((prev) =>
      prev.map((n) =>
        n.id === "node_run" ? { ...n, status: "active" as const } : n,
      ),
    );
    const id = window.setTimeout(() => {
      setTestDone(true);
      setVerifyBusy(null);
      setNodes((prev) =>
        prev.map((n) => ({ ...n, status: "done" as const })),
      );
      setAwaitingVerify(false);
      setShipReady(true);
      setStageId("ship");
      setStreamEvents((prev) => {
        const next = prev.map((e) => ({
          ...e,
          status: "done" as const,
          message:
            e.stage === "ready"
              ? "Ready to ship — open Projects or download files."
              : e.stage === "validate"
                ? "Compile and smoke test passed."
                : e.message,
          time: e.time || nowStamp(),
        }));
        const draft = sessionDraftRef.current;
        if (draft) {
          const doneNodes = draft.nodes.map((n) => ({
            ...n,
            status: "done" as const,
          }));
          sessionDraftRef.current = {
            ...draft,
            streamEvents: next,
            nodes: doneNodes,
          };
          savePersistedSession({
            id: draft.id,
            title: draft.title,
            status: "healthy",
            model: "Aomi",
            updatedAt: "just now",
            runtime: "local",
            stageId: "ship",
            messages: draft.messages,
            streamEvents: next,
            fileTree: draft.fileTree,
            nodes: doneNodes,
          });
        }
        return next;
      });
    }, 700);
    timersRef.current.push(id);
  }, [compileDone, testDone, verifyBusy]);

  return {
    activeSessionId,
    engineRunId,
    stageId,
    messages,
    streamEvents,
    fileTree,
    nodes,
    isGenerating,
    streamingMessageId,
    setStreamingMessageId,
    awaitingVerify,
    compileDone,
    testDone,
    verifyBusy,
    shipReady,
    showStreamInThread,
    loadSession,
    startNewSession,
    cancelPipeline,
    runBuildPipeline,
    handleStreamComplete,
    runCompile,
    runTest,
    recentSessions,
  };
}
