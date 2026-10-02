import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";

// Actual Portal rendering with controlled browser API and HTTP SSE fixtures.
// This checks UI/SDK behavior; it does not authenticate or exercise the Rust BFF.
const harness = process.argv.includes("--harness");
const origin =
  process.env.LOCAL_PORTAL_URL ??
  (harness ? "http://127.0.0.1:3317" : "http://localhost:3000");
const shellId = harness ? "chat-controls-shell" : "portal-shell";
let vite;
if (harness) {
  const { createServer: createViteServer } =
    await import("../apps/widget-consumer/node_modules/vite/dist/node/index.js");
  vite = await createViteServer({
    configFile: resolve("tests/chat-controls-browser/vite.config.mjs"),
  });
  await vite.listen();
}
const output = resolve(
  process.env.CHAT_CONTROLS_ARTIFACTS ?? "artifacts/issue-696",
);
mkdirSync(output, { recursive: true });
const report = {
  origin,
  frontendRoot: process.cwd(),
  frontendBranch: execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim(),
  frontendHead: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  integration: harness
    ? "Actual shared widget AomiFrame/Thread + SDK/runtime source in Vite; synthetic account-session availability, REST and HTTP SSE upstream"
    : "Actual Portal UI; synthetic anonymous identity, REST and HTTP SSE upstream",
  realBackendIntegration: "Not exercised by this fixture runner",
  portalHostIntegration: harness
    ? "BLOCKED: Webpack heap OOM at managed 6GiB; Turbopack process-tree memory ceiling at5.6GiB"
    : "Controlled browser fixture only",
  visualLimitations: harness
    ? "Shared widget default stylesheet and system font fallbacks; full Portal host could not compile within managed memory limits"
    : "Local Next dev uses fallback fonts because Google Fonts downloads were blocked",
  scenarios: [],
};
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});
report.browserVersion = browser.version();
try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.name === "mobile",
      hasTouch: viewport.name === "mobile",
    });
    const page = await context.newPage();
    const records = [];
    const unexpected = [];
    let sequence = 0;
    let turn = 0;
    let thread;
    let interruptCount = 0;
    let streamFrames = 0;
    let failNextInterrupt = false;
    let startGate;
    const streams = new Set();
    const event = (type, data) => ({
      type,
      event_id: `fixture-event-${++sequence}`,
      sequence,
      turn_id: `fixture-turn-${turn}`,
      occurred_at: Date.now() / 1000,
      ...data,
    });
    const eventPage = (events = thread?.events ?? []) => ({
      session_id: thread?.id,
      cursor: String(sequence),
      events,
      has_more: false,
    });
    const publish = (kind, value) => {
      for (const response of streams) {
        response.write(`event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`);
        streamFrames++;
      }
    };
    const upstream = createServer((request, response) => {
      const cors = {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-headers":
          request.headers["access-control-request-headers"] ??
          "accept,authorization,content-type,x-session-id",
        "access-control-allow-methods": "GET,OPTIONS",
      };
      if (request.method === "OPTIONS")
        return response.writeHead(204, cors).end();
      response.writeHead(200, {
        "content-type": "text/event-stream",
        ...cors,
        "cache-control": "no-cache",
      });
      response.write(": controlled stream connected\n\n");
      streams.add(response);
      response.on("close", () => streams.delete(response));
    });
    await new Promise((accept) => upstream.listen(0, "127.0.0.1", accept));
    const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
    const schedule = (work, ms) => {
      const timer = setTimeout(work, ms);
      timer.unref();
    };
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin || url.origin === upstreamOrigin)
        return route.continue();
      return route.abort();
    });
    await page.route(
      (url) => /^\/(?:api|v1)\//.test(url.pathname),
      async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const json = (body, status = 200) =>
          route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
          });
        if (path === "/api/auth/get-session")
          return json({ user: { id: "fixture-696-guest", isAnonymous: true } });
        if (path === "/api/auth/sign-in/anonymous")
          return json({ user: { id: "fixture-696-guest", isAnonymous: true } });
        if (
          path === "/api/account" ||
          path === "/v1/account" ||
          path === "/api/account/model-keys"
        )
          return json({ error: "unauthorized" }, 401);
        if (path.endsWith("/models")) return json(["fixture-model"]);
        if (path.endsWith("/apps"))
          return json([{ name: "default", is_public: true }]);
        if (path === "/api/resource/skills") return json({ skills: [] });
        if (path === "/v1/agent/sessions")
          return json({
            sessions: thread
              ? [
                  {
                    id: thread.id,
                    title: "Chat turn controls fixture",
                    updatedAt: Date.now(),
                    archived: false,
                  },
                ]
              : [],
            nextCursor: null,
          });
        if (/^\/v1\/agent\/sessions\/[^/]+$/.test(path))
          return json({
            id: thread.id,
            title: "Chat turn controls fixture",
            updatedAt: Date.now(),
            archived: false,
          });
        if (path === "/v1/agent/chat" && request.method() === "POST") {
          const intent = request.postDataJSON();
          records.push({ type: "start", ...intent, at: performance.now() });
          turn++;
          thread ??= { id: intent.sessionId, events: [], state: "complete" };
          thread.currentPrompt = intent.message;
          const target = intent.regenerate ?? intent.edit;
          const selected =
            target &&
            thread.events.find(
              (entry) =>
                entry.type === "message" && entry.message_key === target,
            );
          const user = intent.edit
            ? selected
            : intent.regenerate
              ? thread.events.find(
                  (entry) =>
                    entry.type === "message" &&
                    entry.sender === "user" &&
                    (entry.turn_id === selected.turn_id ||
                      entry.message_key ===
                        thread.events.findLast(
                          (candidate) =>
                            candidate.type === "branch" &&
                            candidate.turn_id === selected.turn_id,
                        )?.user_message_key),
                )
              : undefined;
          const initial = target
            ? [
                event("branch", {
                  kind: intent.edit ? "edit" : "regenerate",
                  target_message_key: target,
                  user_message_key: user.message_key,
                  content: intent.message,
                  removed_message_keys: thread.events
                    .filter(
                      (entry) =>
                        entry.type === "message" && entry.sender === "agent",
                    )
                    .map((entry) => entry.message_key),
                  removed_turn_ids: [
                    ...new Set(thread.events.map((entry) => entry.turn_id)),
                  ],
                }),
              ]
            : [
                event("message", {
                  sender: "user",
                  content: intent.message,
                  message_key: `fixture-user-${turn}`,
                }),
              ];
          if (intent.message.includes("interruption fixture")) {
            thread.state = "processing";
            initial.push(event("turn_state_changed", { state: "processing" }));
            if (!intent.message.includes("thinking"))
              initial.push(
                event("tool_update", {
                  id: `fixture-tool-${turn}`,
                  call_id: `fixture-call-${turn}`,
                  tool_name: "get_balance",
                  result: { status: "working", fixture: true },
                }),
              );
            thread.events.push(...initial);
            if (intent.message.includes("delayed-start")) {
              startGate = delay(700);
              await startGate;
              startGate = undefined;
            }
            const streamingTurn = `fixture-turn-${turn}`;
            schedule(
              () =>
                publish("message", {
                  turn_id: streamingTurn,
                  revision: 1,
                  message: {
                    sender: "agent",
                    message_key: `${streamingTurn}:trace:0`,
                    content: "Streaming fixture response before Stop.",
                  },
                }),
              intent.message.includes("thinking") ? 2_500 : 350,
            );
            return json({
              ...eventPage(initial),
              started_turn_id: `fixture-turn-${turn}`,
            });
          }
          await delay(intent.regenerate ? 700 : 150);
          const answer = intent.regenerate
            ? "Regenerated answer fixture: original actions were not repeated."
            : intent.edit
              ? "Edited answer fixture: the selected request was replaced."
              : "Initial answer fixture: ready for edit and rerun.";
          initial.push(
            event("message", {
              sender: "agent",
              content: answer,
              message_key: `fixture-answer-${turn}`,
            }),
            event("turn_state_changed", { state: "complete" }),
          );
          thread.events.push(...initial);
          thread.state = "complete";
          return json({
            ...eventPage(initial),
            started_turn_id: `fixture-turn-${turn}`,
          });
        }
        if (/^\/v1\/agent\/chat\/[^/]+\/stream$/.test(path)) {
          records.push({ type: "stream", at: performance.now() });
          return route.continue({ url: `${upstreamOrigin}/stream` });
        }
        if (/^\/v1\/agent\/chat\/[^/]+\/interrupt$/.test(path)) {
          interruptCount++;
          records.push({
            type: "interrupt",
            ...request.postDataJSON(),
            at: performance.now(),
          });
          await delay(650);
          if (failNextInterrupt) {
            failNextInterrupt = false;
            return json(
              {
                error: {
                  code: "fixture_interrupt_failed",
                  message: "Controlled interrupt failure",
                  retryable: true,
                },
              },
              503,
            );
          }
          thread.state = "interrupted";
          const terminal = event("turn_state_changed", {
            state: "interrupted",
          });
          thread.events.push(terminal);
          return json({
            ...eventPage(
              thread.currentPrompt.includes("delayed-start") ? [] : [terminal],
            ),
            stopped_turn_id: terminal.turn_id,
          });
        }
        if (/^\/v1\/agent\/chat\/[^/]+$/.test(path)) {
          if (startGate) await startGate;
          const cursor = Number(url.searchParams.get("cursor") ?? 0);
          return json(
            eventPage(thread.events.filter((entry) => entry.sequence > cursor)),
          );
        }
        unexpected.push(`${request.method()} ${path}`);
        return json(
          { error: "Unhandled issue-696 browser fixture route" },
          599,
        );
      },
    );
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId(shellId)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(shellId)).not.toHaveAttribute("inert", "", {
        timeout: 60_000,
      });
      const composer = page.getByRole("textbox", { name: "Message input" });
      await composer.fill("Original request fixture: explain the last answer.");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByText("Initial answer fixture: ready for edit and rerun.", {
          exact: true,
        }),
      ).toBeVisible({ timeout: 30_000 });
      const rerun = page
        .getByRole("button", { name: "Rerun", exact: true })
        .last();
      await rerun.evaluate((button) => {
        button.click();
        button.click();
        button.click();
      });
      await expect(
        page.getByText(
          "Regenerated answer fixture: original actions were not repeated.",
          { exact: true },
        ),
      ).toBeVisible();
      assert.equal(
        records.filter((record) => record.type === "start" && record.regenerate)
          .length,
        1,
        "Repeated Rerun must issue one start",
      );
      assert.equal(
        records.find((record) => record.regenerate)?.regenerate,
        "fixture-answer-1",
        "Rerun must target the selected durable answer",
      );
      await expect(
        page.getByText("Initial answer fixture: ready for edit and rerun.", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(page.locator(".aui-user-message-root")).toHaveCount(1);
      await page.screenshot({
        path: `${output}/${viewport.name}-rerun.png`,
        fullPage: true,
      });
      const firstUser = page.locator(".aui-user-message-root").first();
      const editButton = firstUser.getByRole("button", {
        name: "Edit",
        exact: true,
      });
      if (viewport.name === "mobile") {
        await expect(editButton).toBeVisible();
        await editButton.tap();
      } else {
        await firstUser.hover();
        await editButton.click();
      }
      const edit = page.locator(".aui-edit-composer-input");
      await edit.fill("Revised request fixture: explain it more simply.");
      await page
        .getByRole("button", { name: "Save and resend", exact: true })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await expect(
        page.getByText(
          "Edited answer fixture: the selected request was replaced.",
          { exact: true },
        ),
      ).toBeVisible();
      const edits = records.filter(
        (record) => record.type === "start" && record.edit,
      );
      assert.equal(edits.length, 1, "Repeated save must issue one edit");
      assert.equal(edits[0].edit, "fixture-user-1");
      assert.match(
        edits[0].message,
        /Revised request fixture: explain it more simply/,
      );
      await expect(
        page.getByText("Original request fixture: explain the last answer.", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Revised request fixture: explain it more simply.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Regenerated answer fixture: original actions were not repeated.",
          { exact: true },
        ),
      ).toHaveCount(0);
      await expect(page.locator(".aui-user-message-root")).toHaveCount(1);
      await page.screenshot({
        path: `${output}/${viewport.name}-edit.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Rerun", exact: true })
        .last()
        .click();
      await expect(
        page.getByText(
          "Regenerated answer fixture: original actions were not repeated.",
          { exact: true },
        ),
      ).toBeVisible();
      const rerunAfterEdit = records
        .filter((entry) => entry.type === "start" && entry.regenerate)
        .at(-1);
      assert.equal(
        rerunAfterEdit.regenerate,
        "fixture-answer-3",
        "Rerun after edit must target the edited answer",
      );
      assert.equal(
        rerunAfterEdit.message,
        "Revised request fixture: explain it more simply.",
        "Rerun after edit must preserve revised content",
      );
      await expect(page.locator(".aui-user-message-root")).toHaveCount(1);
      await page.screenshot({
        path: `${output}/${viewport.name}-rerun-edited.png`,
        fullPage: true,
      });
      await composer.fill("thinking interruption fixture");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Stop generating", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Streaming fixture response before Stop.", {
          exact: true,
        }),
      ).toHaveCount(0);
      await page.screenshot({
        path: `${output}/${viewport.name}-thinking.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Stop generating", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeVisible();
      assert.equal(interruptCount, 1, "Thinking-only turn stops once");
      await composer.fill("stream interruption fixture");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByText("Streaming fixture response before Stop.", {
          exact: true,
        }),
      ).toBeVisible();
      assert.ok(streamFrames > 0, "Actual HTTP SSE frame must reach the UI");
      await page.screenshot({
        path: `${output}/${viewport.name}-streaming.png`,
        fullPage: true,
      });
      const stop = page.getByRole("button", {
        name: "Stop generating",
        exact: true,
      });
      const feedbackMs = await stop.evaluate(
        (button) =>
          new Promise((resolveFeedback) => {
            const clickedAt = performance.now();
            const feedback = new MutationObserver(() => {
              const pending = document.querySelector(
                '[aria-label="Stopping generation"]',
              );
              if (
                pending?.disabled &&
                pending.getAttribute("aria-busy") === "true"
              ) {
                feedback.disconnect();
                resolveFeedback(performance.now() - clickedAt);
              }
            });
            feedback.observe(document.body, {
              subtree: true,
              childList: true,
              attributes: true,
            });
            window.__issue696StopAcknowledged = new Promise(
              (resolveAcknowledgement) => {
                const acknowledgement = new MutationObserver(() => {
                  const send = document.querySelector(
                    '[aria-label="Send message"]',
                  );
                  if (send && send.getBoundingClientRect().width > 0) {
                    acknowledgement.disconnect();
                    resolveAcknowledgement(performance.now() - clickedAt);
                  }
                });
                acknowledgement.observe(document.body, {
                  subtree: true,
                  childList: true,
                  attributes: true,
                });
              },
            );
            button.click();
            button.click();
            button.click();
          }),
      );
      await expect(
        page.getByRole("button", { name: "Stopping generation", exact: true }),
      ).toBeDisabled();
      await page.screenshot({
        path: `${output}/${viewport.name}-stopping.png`,
        fullPage: true,
      });
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeVisible();
      const settledMs = await page.evaluate(
        () => window.__issue696StopAcknowledged,
      );
      assert.equal(
        interruptCount,
        2,
        "Thinking Stop plus repeated Working Stop must issue two interrupts",
      );
      publish("message", {
        turn_id: `fixture-turn-${turn}`,
        revision: 2,
        message: {
          sender: "agent",
          message_key: `fixture-turn-${turn}:trace:0`,
          content: "STALE STREAM MUST NOT APPEAR",
        },
      });
      await delay(150);
      await expect(
        page.getByText("STALE STREAM MUST NOT APPEAR", { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: `${output}/${viewport.name}-stopped.png`,
        fullPage: true,
      });
      // An interrupt failure must preserve a running stream and offer a retry.
      await composer.fill("stream interruption fixture retry");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page
          .getByText("Streaming fixture response before Stop.", { exact: true })
          .last(),
      ).toBeVisible();
      failNextInterrupt = true;
      await page
        .getByRole("button", { name: "Stop generating", exact: true })
        .click();
      await expect(
        page.getByText("Unable to stop generation", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Stop generating", exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        path: `${output}/${viewport.name}-stop-retry.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Stop generating", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeVisible();
      // Stop during the outstanding start POST must target the newly acknowledged turn.
      await composer.fill("stream interruption fixture delayed-start");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Stop generating", exact: true })
        .evaluate((button) => {
          button.click();
          button.click();
        });
      await expect(
        page.getByRole("button", { name: "Stopping generation", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).toBeVisible();
      assert.equal(
        records.filter((entry) => entry.type === "interrupt").at(-1).turnId,
        `fixture-turn-${turn}`,
        "Early Stop must interrupt the newly accepted turn",
      );
      assert.ok(
        records.filter((entry) => entry.type === "interrupt").at(-1).at -
          records.filter((entry) => entry.type === "start").at(-1).at >=
          600,
        "Early Stop must wait for delayed start acknowledgement",
      );
      assert.equal(
        interruptCount,
        5,
        "Thinking stop, working stop, rejected stop, retry and early Stop issue five total requests",
      );
      await page.screenshot({
        path: `${output}/${viewport.name}-early-stopped.png`,
        fullPage: true,
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId(shellId)).not.toHaveAttribute("inert", "");
      const row = page.locator(`[data-thread-id="${thread.id}"]`);
      if (!(await row.isVisible()) && viewport.name === "mobile") {
        await page
          .getByRole("button", { name: "Toggle Sidebar", exact: true })
          .first()
          .click();
      }
      await row.locator(".aui-thread-list-item-trigger").click();
      await expect(
        page.getByText(
          "Regenerated answer fixture: original actions were not repeated.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByText("Original request fixture: explain the last answer.", {
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Revised request fixture: explain it more simply.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Stop generating", exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: `${output}/${viewport.name}-reloaded.png`,
        fullPage: true,
      });
      assert.deepEqual(unexpected, []);
      report.scenarios.push({
        viewport: viewport.name,
        result: "PASS",
        repeatedRerunStarts: 1,
        totalRegenerationStarts: 2,
        regenerationAfterEdit: "PASS",
        repeatedEditStarts: 1,
        repeatedInterruptRequests: 1,
        totalInterruptRequests: interruptCount,
        thinkingOnlyStop: "PASS",
        workingToolAndStreamingStop: "PASS",
        failedInterruptRetry: "PASS",
        stopBeforeStartAcknowledgement: "PASS",
        streamingFrames: streamFrames,
        feedbackMs: Math.round(feedbackMs),
        latencyMeasurement:
          "Browser MutationObserver timestamps from click to pending control and click to visible Send; synthetic 650ms upstream acknowledgement delay",
        boundedInterruptAcknowledgement:
          "PASS (stopped_turn_id without terminal event)",
        interruptAcknowledgedMs: Math.round(settledMs),
        records,
      });
    } catch (error) {
      await page
        .screenshot({
          path: `${output}/${viewport.name}-failure.png`,
          fullPage: true,
        })
        .catch(() => {});
      report.scenarios.push({
        viewport: viewport.name,
        result: "FAIL",
        error: String(error),
        records,
        unexpected,
      });
      throw error;
    } finally {
      for (const response of streams) response.end();
      await new Promise((accept) => upstream.close(accept));
      await context.close();
    }
  }
} finally {
  writeFileSync(
    `${output}/browser-report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await browser.close();
  await vite?.close();
}
console.log(
  JSON.stringify(
    report.scenarios.map(({ records, ...result }) => result),
    null,
    2,
  ),
);
