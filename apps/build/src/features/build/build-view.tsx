"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as FileDialog from "@radix-ui/react-dialog";
import {
  Files,
  Hammer,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Square,
} from "lucide-react";

import { useToast } from "@/components/control-plane/toast";
import { BuildStreamTimeline } from "@/features/build/components/build-stream-timeline";
import {
  ChatMessage,
  TypingIndicator,
} from "@/features/build/components/chat-message";
import { CompileTestPanel } from "@/features/build/components/compile-test-panel";
import { FileTreePreview } from "@/features/build/components/file-tree-preview";
import {
  IntentComposer,
  type IntentComposerHandle,
} from "@/features/build/components/intent-composer";
import { SessionHistory } from "@/features/build/components/session-history";
import { ShipHandoffBanner } from "@/features/build/components/ship-handoff-banner";
import { SmithersNodes } from "@/features/build/components/smithers-nodes";
import { TemplateGallery } from "@/features/build/components/template-gallery";
import {
  JOURNEY_STAGES,
  resolveDisplayJourneyStage,
  type BuildFileNode,
} from "@/features/build/contracts";
import {
  BUILD_ENGINE_ACTIVE,
  useBuildSession,
} from "@/features/build/hooks/use-build-session";
import { useStreamingText } from "@/features/build/hooks/use-streaming-text";
import {
  getInitialRecentRailOpen,
  writeRecentRailPreference,
} from "@/features/build/storage/recent-rail-preference";
import { BUILD_TEMPLATES } from "@/features/build/templates";
import { cn } from "@/lib/class-names";

const actionPills = [
  { label: "Arb bot", action: "tpl_arbitrage_bot" },
  { label: "OpenAPI agent", action: "tpl_openapi_agent" },
  { label: "Plan from idea", hint: "⇧Tab", action: "plan" },
];

function flattenPaths(nodes: BuildFileNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    out.push(node.path);
    if (node.children) flattenPaths(node.children, out);
  }
  return out;
}

function StreamingMessage({
  content,
  onDone,
  model,
}: {
  content: string;
  onDone: () => void;
  model?: string;
}) {
  const { displayed, isStreaming, skipToEnd } = useStreamingText(content, true);

  useEffect(() => {
    if (!isStreaming && displayed) onDone();
  }, [isStreaming, displayed, onDone]);

  return (
    <ChatMessage
      role="assistant"
      content={displayed}
      isStreaming={isStreaming}
      onStop={skipToEnd}
      model={model}
    />
  );
}

function ContextPanelSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Files;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="text-subtle flex items-center gap-1.5 px-1 text-[12px] font-medium">
        <Icon className="text-dim size-3.5" />
        {title}
      </div>
      {children}
    </section>
  );
}

/**
 * AI Builder Create surface. Nested in ControlPlaneShell — no BuildLayout.
 */
export function BuildView() {
  const [input, setInput] = useState("");
  const [fileView, setFileView] = useState<{
    path: string;
    content: string;
  } | null>(null);
  // SSR-safe false; restore preference after mount to avoid hydration mismatch.
  const [recentOpen, setRecentOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<IntentComposerHandle>(null);
  const { toast } = useToast();

  useEffect(() => {
    setRecentOpen(getInitialRecentRailOpen());
  }, []);

  const toggleRecentRail = useCallback(() => {
    setRecentOpen((prev) => {
      const next = !prev;
      writeRecentRailPreference(next);
      return next;
    });
  }, []);

  const {
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
  } = useBuildSession();

  const displayStageId = useMemo(
    () =>
      resolveDisplayJourneyStage({
        stageId,
        isGenerating,
        awaitingVerify,
        shipReady,
        compileDone,
        testDone,
        verifyBusy,
        streamEvents,
        messageCount: messages.length,
      }),
    [
      stageId,
      isGenerating,
      awaitingVerify,
      shipReady,
      compileDone,
      testDone,
      verifyBusy,
      streamEvents,
      messages.length,
    ],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [
    messages,
    streamingMessageId,
    showStreamInThread,
    nodes,
    awaitingVerify,
    shipReady,
    fileTree,
    scrollToBottom,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        startNewSession();
        setInput("");
        requestAnimationFrame(() => composerRef.current?.focus());
        return;
      }
      // Shell sidebar is click-only; ⌘B toggles Create Recent rail.
      if (key === "b") {
        e.preventDefault();
        toggleRecentRail();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startNewSession, toggleRecentRail]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput("");
    runBuildPipeline(text, (assistantMsg) => {
      setStreamingMessageId(assistantMsg.id);
    });
  }, [input, isGenerating, runBuildPipeline, setStreamingMessageId]);

  const handleStop = useCallback(() => {
    cancelPipeline();
    toast({
      title: "Stopped",
      description: "Build cancelled.",
      tone: "info",
    });
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [cancelPipeline, toast]);

  const handleStreamDone = useCallback(() => {
    handleStreamComplete();
  }, [handleStreamComplete]);

  const handleActionPill = useCallback((action: string) => {
    if (action === "plan") {
      setInput("Help me plan a new agent idea: ");
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    const template = BUILD_TEMPLATES.find((t) => t.id === action);
    if (template) {
      setInput(template.prompt);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }, []);

  const handleDownload = useCallback(() => {
    // Real runs download the generated crate as a tarball.
    if (BUILD_ENGINE_ACTIVE && engineRunId) {
      window.location.assign(
        `/api/bff/build/runs/download?id=${encodeURIComponent(engineRunId)}`,
      );
      toast({
        title: "Downloading crate",
        description: "Generated app source as .tar.gz.",
        tone: "success",
      });
      return;
    }
    const paths = flattenPaths(fileTree);
    const blob = new Blob(
      [
        "# Aomi Build — file list\n",
        `# Session ${activeSessionId ?? "unknown"}\n`,
        "# Full archive download comes when generate is connected.\n\n",
        paths.join("\n"),
        "\n",
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aomi-build-files.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "Downloaded file list",
      description: `${paths.length} paths listed — archive download comes later.`,
      tone: "success",
    });
  }, [activeSessionId, engineRunId, fileTree, toast]);

  /** Source viewer — engine runs only (mock files have no contents). */
  const handleFileSelect = useCallback(
    (path: string) => {
      if (!engineRunId) return;
      void (async () => {
        try {
          const res = await fetch(
            `/api/bff/build/runs/file?id=${encodeURIComponent(engineRunId)}&path=${encodeURIComponent(path)}`,
          );
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            toast({
              title: "Could not open file",
              description: body.error ?? `request failed (${res.status})`,
              tone: "error",
            });
            return;
          }
          setFileView({ path, content: await res.text() });
        } catch (error) {
          toast({
            title: "Could not open file",
            description: error instanceof Error ? error.message : String(error),
            tone: "error",
          });
        }
      })();
    },
    [engineRunId, toast],
  );

  const handleTemplateSelect = useCallback(
    (template: (typeof BUILD_TEMPLATES)[0]) => {
      setInput(template.prompt);
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [],
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      loadSession(id);
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [loadSession],
  );

  const handleNewSession = useCallback(() => {
    startNewSession();
    setInput("");
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [startNewSession]);

  const isEmpty = messages.length === 0;
  const stageIndex = JOURNEY_STAGES.findIndex((s) => s.id === displayStageId);
  const composerBlocked =
    awaitingVerify && !shipReady
      ? "Finish Compile → smoke test below, or start a new build (⌘N)."
      : undefined;

  /** Plan steps in-thread on lg+ only — mobile already shows Progress. */
  const showPlanNodes =
    nodes.length > 0 &&
    isGenerating &&
    (displayStageId === "plan" || displayStageId === "generate");

  return (
    <div
      data-testid="build-shell"
      className="flex h-[calc(100dvh-2.75rem)] min-h-0 w-full"
    >
      {recentOpen ? (
        <aside className="border-border flex w-[220px] shrink-0 flex-col gap-3 overflow-y-auto border-r p-3">
          <SessionHistory
            sessions={recentSessions}
            activeSessionId={activeSessionId}
            onSelect={handleSelectSession}
            onNewSession={handleNewSession}
          />
        </aside>
      ) : null}

      <section className="bg-background flex min-w-0 flex-1 flex-col">
        <div className="border-border flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={toggleRecentRail}
              className="icon-button inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
              title={recentOpen ? "Hide Recent (⌘B)" : "Show Recent (⌘B)"}
              aria-label={recentOpen ? "Hide Recent" : "Show Recent"}
              aria-pressed={recentOpen}
            >
              {recentOpen ? (
                <PanelLeftClose className="size-3.5" />
              ) : (
                <PanelLeftOpen className="size-3.5" />
              )}
            </button>
            {!isEmpty ? (
              <ol className="hidden min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:flex">
                {JOURNEY_STAGES.map((stage, index) => {
                  const active = index === stageIndex;
                  const done = index < stageIndex;
                  return (
                    <li
                      key={stage.id}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        active
                          ? "border-foreground/30 text-foreground bg-surface-1"
                          : done
                            ? "border-border text-dim"
                            : "border-border/60 text-dim/70",
                      )}
                    >
                      {stage.title}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-dim text-[12px]">Create</p>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {isGenerating ? (
              <button
                type="button"
                onClick={handleStop}
                className="border-border text-foreground hover:bg-accent/40 inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]"
              >
                <Square className="size-2.5 fill-current" />
                Stop
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleNewSession}
              className="border-border text-foreground hover:bg-accent/40 inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px]"
              title="New session (⌘N)"
            >
              <Plus className="size-3" />
              New
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-7xl shrink-0 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Hammer className="text-dim size-5" aria-hidden />
            <h1 className="font-display text-xl font-normal tracking-tight">
              Build
            </h1>
          </div>
          <p className="text-dim mt-1.5 max-w-3xl text-sm leading-5">
            Describe an agent, review the plan and files, compile, smoke-test,
            then ship to Projects.
          </p>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              {isEmpty ? (
                <div className="flex justify-center px-4 pb-8 pt-8 sm:pt-10">
                  <div className="w-full max-w-[640px]">
                    <IntentComposer
                      ref={composerRef}
                      value={input}
                      onChange={setInput}
                      onSubmit={handleSend}
                      onStop={handleStop}
                      disabled={isGenerating}
                      isLoading={isGenerating}
                      actionPills={actionPills}
                      onActionPillClick={handleActionPill}
                      placeholder="Describe an agent — e.g. hyperliquid & binance arb bot"
                      autoFocus
                    />
                    <TemplateGallery
                      templates={BUILD_TEMPLATES}
                      onSelect={handleTemplateSelect}
                    />
                  </div>
                </div>
              ) : (
                <div className="mx-auto w-full max-w-3xl space-y-1 px-4 pb-3 pt-3">
                  {messages.map((msg) => {
                    if (streamingMessageId === msg.id) {
                      return (
                        <StreamingMessage
                          key={msg.id}
                          content={msg.content}
                          model={msg.model}
                          onDone={handleStreamDone}
                        />
                      );
                    }
                    return (
                      <ChatMessage
                        key={msg.id}
                        role={msg.role}
                        content={msg.content}
                        timestamp={msg.timestamp}
                        model={msg.model}
                      />
                    );
                  })}

                  {(showStreamInThread || isGenerating || awaitingVerify) &&
                  streamEvents.length > 0 ? (
                    <div className="my-2 lg:hidden">
                      <BuildStreamTimeline events={streamEvents} />
                    </div>
                  ) : null}

                  {showPlanNodes ? (
                    <div className="hidden lg:block">
                      <SmithersNodes nodes={nodes} caption="Plan steps" />
                    </div>
                  ) : null}

                  {awaitingVerify ? (
                    <CompileTestPanel
                      compileDone={compileDone}
                      testDone={testDone}
                      busy={verifyBusy}
                      onCompile={runCompile}
                      onTest={runTest}
                    />
                  ) : null}

                  {shipReady ? (
                    <ShipHandoffBanner onDownload={handleDownload} />
                  ) : null}

                  {isGenerating && !streamingMessageId ? (
                    <TypingIndicator />
                  ) : null}
                </div>
              )}
            </div>

            {!isEmpty ? (
              <div className="border-border border-t px-4 py-3">
                <div className="mx-auto max-w-3xl space-y-1.5">
                  {composerBlocked ? (
                    <p className="text-dim text-center text-[11px]">
                      {composerBlocked}
                    </p>
                  ) : null}
                  <IntentComposer
                    ref={composerRef}
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSend}
                    onStop={handleStop}
                    disabled={isGenerating || (awaitingVerify && !shipReady)}
                    isLoading={isGenerating}
                    compact
                    footerHint=""
                    actionPills={
                      awaitingVerify && !shipReady ? undefined : actionPills
                    }
                    onActionPillClick={handleActionPill}
                    placeholder={
                      awaitingVerify && !shipReady
                        ? "Verify below, or ⌘N for a new build…"
                        : "Refine or start another build…"
                    }
                  />
                </div>
              </div>
            ) : null}
          </div>

          {!isEmpty ? (
            <aside className="border-border bg-surface-1/40 hidden w-[280px] shrink-0 flex-col gap-3 overflow-y-auto border-l p-3 lg:flex">
              <ContextPanelSection title="Progress" icon={ListChecks}>
                <BuildStreamTimeline events={streamEvents} compact />
              </ContextPanelSection>

              <ContextPanelSection title="Files" icon={Files}>
                <FileTreePreview
                  tree={fileTree}
                  onFileSelect={
                    BUILD_ENGINE_ACTIVE && engineRunId
                      ? handleFileSelect
                      : undefined
                  }
                />
              </ContextPanelSection>
            </aside>
          ) : null}
        </div>
      </section>
      <FileDialog.Root
        open={fileView !== null}
        onOpenChange={(open) => {
          if (!open) setFileView(null);
        }}
      >
        <FileDialog.Portal>
          <FileDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <FileDialog.Content className="border-border bg-background fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(760px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border shadow-lg">
            <FileDialog.Title className="text-subtle border-border border-b px-4 py-2 font-mono text-[12px]">
              {fileView?.path}
            </FileDialog.Title>
            <pre className="max-h-[70vh] overflow-auto whitespace-pre px-4 py-3 text-[12px] leading-relaxed">
              {fileView?.content}
            </pre>
          </FileDialog.Content>
        </FileDialog.Portal>
      </FileDialog.Root>
    </div>
  );
}
