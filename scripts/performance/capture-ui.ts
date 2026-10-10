/**
 * Cold-load, Library and long streamed turn capture against a production
 * Portal: `pnpm exec tsx scripts/performance/capture-ui.ts --url <portal>`.
 * Auth, account, catalogs and UI are real; only agent traffic goes to the
 * fake agent server. Fails when first-load JS exceeds its budget or a warm
 * Library reopen fetches the catalog again.
 */
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type Page } from "@playwright/test";
import type { EventBody } from "../../tests/e2e/fake-backend/protocol";
import { createFakeAgentServer } from "../../tests/e2e/fake-backend/server";
import {
  perfObserverScript,
  readPerfWindow,
  startPerfWindow,
} from "../../tests/e2e/performance/observer";

const firstLoadBudgetBytes = 1_200 * 1024;
const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const url = option("--url");
if (!url || !/^https?:\/\//.test(url))
  throw new Error("Pass --url for a production Portal");
const buildOutput = resolve(
  option("--build-output", "apps/portal/.output/public")!,
);
const directory = resolve(option("--output", "output/performance")!);
await mkdir(directory, { recursive: true });
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const fixture = await createFakeAgentServer();
const backend = fixture.backend;
const captures: { kind: string; errors?: string[]; [key: string]: unknown }[] =
  [];
let browser: Browser | undefined;
let activePage: Page | undefined;
const report = () => ({
  capturedAt: new Date().toISOString(),
  sourceSha,
  url,
  timingScope:
    "fresh browser loads with a real anonymous cookie established before timing; only agent traffic uses the fake agent server",
  captures,
});

try {
  browser = await chromium.launch({ headless: true });
  for (let run = 1; run <= 3; run++) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await signInGuest(context.request);
    const page = await context.newPage();
    activePage = page;
    await page.addInitScript({
      content: `localStorage.setItem("aomi-cookie-consent", "declined"); ${perfObserverScript}`,
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requestsByPath: Record<string, number> = {};
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      requestsByPath[path] = (requestsByPath[path] ?? 0) + 1;
    });
    await page.route(/\/v1\/agent(?:\/|$)/, (route) => {
      const target = new URL(route.request().url());
      return route.continue({
        url: `${fixture.origin}${target.pathname}${target.search}`,
      });
    });
    const started = Date.now();
    await page.goto(url);
    const composer = page.getByTestId("aomi-composer-input");
    await composer.waitFor({ state: "visible" });
    const harnessComposerVisibleMs = Date.now() - started;
    await composer.fill("Readiness draft");
    const send = page.getByTestId("aomi-send");
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>('[data-testid="aomi-send"]')
          ?.disabled,
    );
    const harnessSendReadyMs = Date.now() - started;
    await composer.fill("");
    const load = await readPerfWindow(page);
    const firstLoadJs = await firstLoadScripts(page);
    const firstLoadJsGzipBytes = firstLoadJs.reduce(
      (total, entry) => total + entry.gzipBytes,
      0,
    );
    captures.push({
      kind: "cold-load",
      run,
      composerVisibleMs: load.composerVisibleAt,
      draftInputMs: load.draftInputAt,
      sendReadyMs: load.sendReadyAt,
      sendEnableAfterInputMs:
        load.sendReadyAt !== null && load.draftInputAt !== null
          ? load.sendReadyAt - load.draftInputAt
          : null,
      harnessComposerVisibleMs,
      harnessSendReadyMs,
      requestsByPath: { ...requestsByPath },
      scripts: firstLoadJs,
      firstLoadJsGzipBytes,
      stats: {
        longTasks: load.longTasks,
        layoutShift: load.layoutShift,
        layoutShifts: load.layoutShifts,
      },
      navigation: await page.evaluate(() =>
        performance.getEntriesByType("navigation")[0]?.toJSON(),
      ),
      errors,
    });
    if (!firstLoadJsGzipBytes || firstLoadJsGzipBytes > firstLoadBudgetBytes)
      throw new Error(
        `Guest Portal first-load JS is ${firstLoadJsGzipBytes} gzip bytes; budget ${firstLoadBudgetBytes}`,
      );
    if (run < 3) {
      await context.close();
      continue;
    }

    captures.push({
      kind: "library-opens",
      run,
      opens: await libraryOpens(page, requestsByPath),
      errors,
    });

    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const previousStarts = backend.starts().length;
    await composer.fill("[slow] performance capture");
    await send.click();
    await page.getByTestId("aomi-stop").waitFor();
    const sessionId = await newTurn(previousStarts);
    await startPerfWindow(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    const requestMark = backend.mark();
    const streamingStarted = Date.now();
    const text = await streamLongTurn(sessionId);
    await page
      .getByText("PERFORMANCE_CAPTURE_COMPLETE", { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 60_000 });
    await page.getByTestId("aomi-stop").waitFor({
      state: "hidden",
      timeout: 60_000,
    });
    const elapsedMs = Date.now() - streamingStarted;
    const stats = await readPerfWindow(page);
    const { profile } = await cdp.send("Profiler.stop");
    await writeFile(
      resolve(directory, "long-turn.cpuprofile"),
      JSON.stringify(profile),
    );
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    captures.push({
      kind: "long-tool-text-turn",
      run,
      cpuThrottle: 4,
      toolCount: 40,
      textChars: text.length,
      elapsedMs,
      agentRequests: backend.requestsSince(requestMark),
      cpuProfile: "long-turn.cpuprofile",
      stats,
      errors,
    });
    captures.push({
      kind: "sidebar-actions",
      run,
      cpuThrottle: 1,
      timings: await sidebarActionTimings(page),
      errors,
    });
    await context.close();
  }
  await writeFile(
    resolve(directory, "ui-performance.json"),
    JSON.stringify(report(), null, 2),
  );
  console.log(JSON.stringify(report(), null, 2));
  if (captures.some((capture) => capture.errors?.length))
    throw new Error("A browser error invalidated the capture");
} catch (error) {
  if (activePage && !activePage.isClosed())
    await activePage.screenshot({
      path: resolve(directory, "failure.png"),
      fullPage: true,
    });
  captures.push({ kind: "failure", error: String(error) });
  await writeFile(
    resolve(directory, "ui-performance.json"),
    JSON.stringify(report(), null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  await fixture.close();
}

async function signInGuest(request: Page["request"]) {
  const guest = await request.post(
    new URL("/api/auth/sign-in/anonymous", url).href,
    { headers: { origin: new URL(url!).origin }, data: {} },
  );
  if (!guest.ok()) throw new Error(`Guest sign-in failed (${guest.status()})`);
  const session = await request.get(new URL("/api/auth/get-session", url).href);
  const identity = await session.json();
  if (!identity?.user?.isAnonymous || !identity.user.id)
    throw new Error("Guest identity was not established");
}

/** Script chunks the page loaded, sized as gzip of the build's own files. */
async function firstLoadScripts(page: Page) {
  const paths = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name))
      .filter((resource) => resource.origin === location.origin)
      .map((resource) => resource.pathname),
  );
  return [...new Set(paths)]
    .filter((path) => path.startsWith("/assets/") && /\.m?js$/.test(path))
    .map((path) => ({
      path,
      gzipBytes: gzipSync(
        readFileSync(resolve(buildOutput, decodeURIComponent(path.slice(1)))),
      ).length,
    }));
}

async function libraryOpens(
  page: Page,
  requestsByPath: Record<string, number>,
) {
  const opens = [];
  for (let open = 1; open <= 2; open++) {
    const before = { ...requestsByPath };
    const opened = Date.now();
    await page
      .getByRole("button", { name: "Open capability library", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Library", exact: true });
    await dialog.waitFor({ state: "visible" });
    await dialog
      .getByRole("status", { name: "Loading library" })
      .waitFor({ state: "hidden" });
    if (await dialog.getByRole("alert").count())
      throw new Error("The Library catalog failed to load");
    const catalogRequests = Object.fromEntries(
      Object.entries(requestsByPath)
        .filter(([path]) =>
          /\/api\/(?:public\/catalog|thread|account)\/(?:apps|skills)$/.test(
            path,
          ),
        )
        .map(([path, count]) => [path, count - (before[path] ?? 0)])
        .filter(([, count]) => Number(count) > 0),
    );
    opens.push({ open, fullContentMs: Date.now() - opened, catalogRequests });
    if (open === 2 && Object.keys(catalogRequests).length)
      throw new Error("Warm Library reopened with a catalog request");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  return opens;
}

async function newTurn(previousStarts: number): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (backend.starts().length <= previousStarts) {
    if (Date.now() >= deadline)
      throw new Error("The composer did not start a fake agent turn");
    await new Promise((done) => setTimeout(done, 50));
  }
  const sessionId = backend.starts().at(-1)?.sessionId;
  if (!sessionId) throw new Error("The new fake turn has no session id");
  return sessionId;
}

/** 120 text and tool updates, 40 ms apart, then the terminal answer. */
function streamLongTurn(sessionId: string): Promise<string> {
  const emit = (body: EventBody) => backend.appendTurnEvents(sessionId, [body]);
  let text = "";
  let step = 0;
  return new Promise((done) => {
    const tick = setInterval(() => {
      if (step === 120) {
        clearInterval(tick);
        emit({
          type: "message",
          sender: "agent",
          message_key: "perf-answer",
          content: `${text}\nPERFORMANCE_CAPTURE_COMPLETE`,
        });
        emit({ type: "turn_state_changed", state: "complete" });
        done(text);
        return;
      }
      text += `\n### Result ${step + 1}\nA measured tool result with **formatted text**, a [reference](https://example.com) and \`value_${step}\`. ${"Observed balances and routes. ".repeat(10)}\n`;
      emit({
        type: "message",
        sender: "agent",
        message_key: "perf-answer",
        content: text,
      });
      const tool = Math.floor(step / 3);
      emit({
        type: step % 3 === 2 ? "tool_complete" : "tool_update",
        id: `perf-tool-${tool}`,
        call_id: `perf-call-${tool}`,
        tool_name: "get_balance",
        result: {
          step,
          rows: Array.from({ length: 10 }, (_, index) => ({
            asset: `asset-${index}`,
            balance: "1.5",
          })),
        },
      });
      step++;
    }, 40);
  });
}

/** Rename and archive, timed from the real click to the DOM update. */
async function sidebarActionTimings(page: Page) {
  await page.evaluate(`(() => {
    const timings = window.__aomiSidebarTimings = {};
    document.addEventListener("click", (event) => {
      if (event.target.closest?.('[aria-label="Save chat title"]')) timings.renameStarted = performance.now();
      if (event.target.closest?.('[data-testid="aomi-thread-archive"]')) timings.archiveStarted = performance.now();
    }, true);
    new MutationObserver(() => {
      const renamed = [...document.querySelectorAll('[data-testid="aomi-thread-item-title"]')]
        .some((node) => node.textContent === "Performance renamed chat");
      if (timings.renameStarted && renamed && timings.renameMs === undefined)
        timings.renameMs = performance.now() - timings.renameStarted;
      if (timings.archiveStarted && !renamed && timings.archiveMs === undefined)
        timings.archiveMs = performance.now() - timings.archiveStarted;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  })()`);
  const row = page.getByTestId("aomi-thread-item").first();
  await row.hover();
  await row.getByTestId("aomi-thread-item-menu").click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Chat title" })
    .fill("Performance renamed chat");
  await page.getByRole("button", { name: "Save chat title" }).click();
  await page.waitForFunction(
    "window.__aomiSidebarTimings.renameMs !== undefined",
  );
  await row.hover();
  await row.getByTestId("aomi-thread-item-menu").click();
  await page.getByTestId("aomi-thread-archive").click();
  await page.waitForFunction(
    "window.__aomiSidebarTimings.archiveMs !== undefined",
  );
  return page.evaluate("window.__aomiSidebarTimings");
}
