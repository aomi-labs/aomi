import type { Page } from "@playwright/test";

export type PerfSummary = {
  windowMs: number;
  longTasks: number[];
  longTaskIntervals: { startMs: number; durationMs: number }[];
  p95FrameMs: number | null;
  framesOver50ms: number;
  sidebarMutations: number;
  rootReplacements: number;
  chatReplacements: number;
  layoutShift: number;
  layoutShifts: unknown[];
  composerVisibleAt: number | null;
  draftInputAt: number | null;
  sendReadyAt: number | null;
};

/**
 * In-page recorder for long tasks, frames, layout shift, widget remounts and
 * sidebar DOM writes. Install it with addInitScript (from page load) or
 * page.evaluate (from now); `startPerfWindow` restarts the counted window.
 * It stays a plain string: Playwright serializes it into the page, where
 * tsx's helper functions do not exist.
 */
export const perfObserverScript = `(() => {
  if (window.__aomiPerf) return;
  const ids = {
    frame: '[data-testid="aomi-frame"]',
    chat: '[data-testid="aomi-message-list"]',
    composer: '[data-testid="aomi-composer-input"]',
    send: '[data-testid="aomi-send"]',
    sidebar: '[data-testid="aomi-sidebar"], [data-testid="aomi-mobile-sheet"]',
  };
  let since = 0;
  let tasks = [];
  let frames = [];
  let counts = { sidebarMutations: 0, rootReplacements: 0, chatReplacements: 0 };
  const shifts = { total: 0, entries: [] };
  const ready = { composerVisibleAt: null, draftInputAt: null, sendReadyAt: null };
  const collectTasks = (entries) => {
    for (const entry of entries) tasks.push({ startMs: entry.startTime, durationMs: entry.duration });
  };
  const taskObserver = new PerformanceObserver((list) => collectTasks(list.getEntries()));
  taskObserver.observe({ type: "longtask", buffered: true });
  new PerformanceObserver((list) => {
    for (const shift of list.getEntries()) {
      if (shift.hadRecentInput) continue;
      shifts.total += shift.value;
      if (shifts.entries.length < 100) shifts.entries.push({
        at: shift.startTime,
        value: shift.value,
        sources: shift.sources.map((source) => ({
          node: source.node?.outerHTML?.slice(0, 500),
          previousRect: source.previousRect.toJSON(),
          currentRect: source.currentRect.toJSON(),
        })),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
  document.addEventListener("input", (event) => {
    if (ready.draftInputAt === null && event.target.matches?.(ids.composer) &&
        (event.target.value ?? event.target.textContent))
      ready.draftInputAt = performance.now();
  }, true);
  let root = null;
  let chat = null;
  const collectMutations = (records) => {
    const composer = document.querySelector(ids.composer);
    if (ready.composerVisibleAt === null && composer?.getClientRects().length)
      ready.composerVisibleAt = performance.now();
    const send = document.querySelector(ids.send);
    if (ready.draftInputAt !== null && ready.sendReadyAt === null && send && !send.disabled)
      ready.sendReadyAt = performance.now();
    const nextRoot = document.querySelector(ids.frame);
    const nextChat = document.querySelector(ids.chat);
    if (root && nextRoot && root !== nextRoot) counts.rootReplacements++;
    if (chat && nextChat && chat !== nextChat) counts.chatReplacements++;
    root = nextRoot ?? root;
    chat = nextChat ?? chat;
    for (const record of records)
      if (record.target.closest?.(ids.sidebar)) counts.sidebarMutations++;
  };
  const mutations = new MutationObserver(collectMutations);
  mutations.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  let last = null;
  const measureFrame = (time) => {
    if (last !== null) frames.push(time - last);
    last = time;
    requestAnimationFrame(measureFrame);
  };
  requestAnimationFrame(measureFrame);
  window.__aomiPerf = {
    start() {
      since = performance.now();
      frames = [];
      last = since;
      counts = { sidebarMutations: 0, rootReplacements: 0, chatReplacements: 0 };
    },
    summary() {
      collectTasks(taskObserver.takeRecords());
      collectMutations(mutations.takeRecords());
      const counted = tasks.filter((task) => task.startMs + task.durationMs >= since);
      const sorted = [...frames].sort((a, b) => a - b);
      return {
        windowMs: performance.now() - since,
        longTasks: counted.map((task) => task.durationMs),
        longTaskIntervals: counted,
        p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? null,
        framesOver50ms: sorted.filter((ms) => ms > 50).length,
        ...counts,
        layoutShift: shifts.total,
        layoutShifts: shifts.entries,
        ...ready,
      };
    },
  };
})()`;

export async function startPerfWindow(page: Page): Promise<void> {
  await page.evaluate("window.__aomiPerf.start()");
}

export async function readPerfWindow(page: Page): Promise<PerfSummary> {
  return page.evaluate<PerfSummary>("window.__aomiPerf.summary()");
}
