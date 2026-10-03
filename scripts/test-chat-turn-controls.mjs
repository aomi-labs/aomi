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
  process.env.CHAT_CONTROLS_ARTIFACTS ?? "/tmp/chat-controls-artifacts",
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
    let suppressedTerminalTurn;
    const raceAcknowledgements = [];
    const uncertainStarts = new Map();
    const unadmittedStarts = new Set();
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
          const idempotencyKey = request.headers()["idempotency-key"];
          records.push({
            type: "start",
            ...intent,
            idempotencyKey,
            at: performance.now(),
          });
          const recovered = uncertainStarts.get(idempotencyKey);
          if (recovered)
            return json({ ...eventPage([]), started_turn_id: recovered });
          if (
            intent.message === "unadmitted-start fixture" &&
            !unadmittedStarts.has(idempotencyKey)
          ) {
            unadmittedStarts.add(idempotencyKey);
            thread = {
              id: intent.sessionId,
              events: [],
              state: "complete",
              currentPrompt: intent.message,
            };
            return json(
              {
                error: {
                  code: "upstream_unavailable",
                  message: "Controlled failure before admission",
                  retryable: true,
                },
              },
              503,
            );
          }
          turn++;
          if (thread?.id !== intent.sessionId)
            thread = { id: intent.sessionId, events: [], state: "complete" };
          thread.currentPrompt = intent.message;
          const target = intent.regenerate ?? intent.edit;
          const selected =
            target &&
            thread.events.find(
              (entry) =>
                entry.type === "message" && entry.message_key === target,
            );
          // Edit and Rerun remove the selected user message and everything
          // after it, then run the prompt as a normal turn.
          const user = intent.edit
            ? selected
            : selected &&
              thread.events
                .slice(0, thread.events.indexOf(selected))
                .findLast(
                  (entry) => entry.type === "message" && entry.sender === "user",
                );
          const removed = user
            ? thread.events.slice(thread.events.indexOf(user))
            : [];
          const initial = [
            ...(target
              ? [
                  event("branch", {
                    kind: intent.edit ? "edit" : "regenerate",
                    target_message_key: target,
                    user_message_key: user.message_key,
                    content: intent.message,
                    removed_message_keys: removed
                      .filter((entry) => entry.type === "message")
                      .map((entry) => entry.message_key),
                    removed_turn_ids: [
                      ...new Set(removed.map((entry) => entry.turn_id)),
                    ],
                  }),
                ]
              : []),
            event("message", {
              sender: "user",
              content: intent.message,
              message_key: `fixture-user-${turn}`,
            }),
          ];
          if (!target && intent.message.startsWith("terminal race fixture ")) {
            thread.state = "processing";
            initial.push(
              event("turn_state_changed", { state: "processing" }),
              event("tool_update", {
                id: `fixture-tool-${turn}`,
                call_id: `fixture-call-${turn}`,
                tool_name: "get_balance",
                result: { status: "working", fixture: true },
              }),
              event("message", {
                sender: "agent",
                content: `Durable ${intent.message.endsWith("failed") ? "failed" : "completed"} answer fixture before Stop acknowledgment.`,
                message_key: `fixture-race-answer-${turn}`,
              }),
            );
            thread.events.push(...initial);
            return json({
              ...eventPage(initial),
              started_turn_id: `fixture-turn-${turn}`,
            });
          }
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
            if (intent.message.includes("uncertain-start")) {
              uncertainStarts.set(idempotencyKey, `fixture-turn-${turn}`);
              return json(
                {
                  error: {
                    code: "upstream_unavailable",
                    message: "Controlled lost start response after admission",
                    retryable: true,
                  },
                },
                503,
              );
            }
            if (intent.message.includes("delayed-start")) {
              startGate = delay(700);
              await startGate;
              startGate = undefined;
            }
            const streamingTurn = `fixture-turn-${turn}`;
            const streamPartial = () => {
              if (
                thread.state !== "processing" ||
                streamingTurn !== `fixture-turn-${turn}`
              )
                return;
              if (streams.size === 0) {
                schedule(streamPartial, 50);
                return;
              }
              publish("message", {
                turn_id: streamingTurn,
                revision: 1,
                message: {
                  sender: "agent",
                  message_key: `${streamingTurn}:trace:0`,
                  content: "Streaming fixture response before Stop.",
                },
              });
            };
            schedule(
              streamPartial,
              intent.message.includes("thinking") ? 2_500 : 350,
            );
            return json({
              ...eventPage(initial),
              started_turn_id: `fixture-turn-${turn}`,
            });
          }
          await delay(intent.regenerate || intent.edit ? 700 : 150);
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
          if (intent.message.startsWith("terminal-uncertain fixture ")) {
            const outcome = intent.message.endsWith("failed")
              ? "failed"
              : "complete";
            initial.findLast(
              (entry) => entry.type === "message" && entry.sender === "agent",
            ).content =
              `Terminal-uncertain ${outcome}: durable answer preserved.`;
            initial.at(-1).state = outcome;
            thread.state = outcome;
            return json(
              {
                error: {
                  code: "upstream_unavailable",
                  message: "Controlled lost terminal start response",
                  retryable: true,
                },
              },
              503,
            );
          }
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
          if (thread.currentPrompt.startsWith("terminal race fixture ")) {
            const state = thread.currentPrompt.endsWith("failed")
              ? "failed"
              : "complete";
            const cursor = String(sequence);
            const terminal = event("turn_state_changed", { state });
            thread.state = state;
            thread.events.push(terminal);
            suppressedTerminalTurn = terminal.turn_id;
            const acknowledgment = {
              ...eventPage([]),
              cursor,
              terminal_turn: { turn_id: terminal.turn_id, state },
            };
            raceAcknowledgements.push(acknowledgment);
            return json(acknowledgment);
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
            terminal_turn: { turn_id: terminal.turn_id, state: "interrupted" },
          });
        }
        if (/^\/v1\/agent\/chat\/[^/]+$/.test(path)) {
          if (startGate) await startGate;
          const cursor = Number(url.searchParams.get("cursor") ?? 0);
          return json(
            eventPage(
              thread.events.filter(
                (entry) =>
                  entry.sequence > cursor &&
                  !(
                    entry.turn_id === suppressedTerminalTurn &&
                    entry.type === "turn_state_changed" &&
                    entry.state !== "processing"
                  ),
              ),
            ),
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
      // The replaced answer leaves at once while the request stays and the
      // new answer is generated (the fixture holds it for 700 ms).
      await expect(
        page.getByText("Initial answer fixture: ready for edit and rerun.", {
          exact: true,
        }),
      ).toHaveCount(0, { timeout: 400 });
      await expect(page.locator(".aui-user-message-root")).toHaveCount(1);
      await page.screenshot({
        path: `${output}/${viewport.name}-rerun-pending.png`,
        fullPage: true,
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
        page.getByText("Revised request fixture: explain it more simply.", {
          exact: true,
        }),
      ).toBeVisible({ timeout: 400 });
      await expect(
        page.getByText(
          "Regenerated answer fixture: original actions were not repeated.",
          { exact: true },
        ),
      ).toHaveCount(0, { timeout: 400 });
      await page.screenshot({
        path: `${output}/${viewport.name}-edit-pending.png`,
        fullPage: true,
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
      assert.equal(
        edits[0].edit,
        "fixture-user-2",
        "Edit must target the request that Rerun re-sent",
      );
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
      const stopBounds = await stop.boundingBox();
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
      const pendingStop = page.getByRole("button", {
        name: "Stopping generation",
        exact: true,
      });
      await expect(pendingStop).toBeDisabled();
      await expect(pendingStop).toHaveAttribute("aria-busy", "true");
      await expect(pendingStop).toHaveText("");
      const pendingStopBounds = await pendingStop.boundingBox();
      assert.equal(pendingStopBounds?.width, stopBounds?.width);
      assert.equal(pendingStopBounds?.height, stopBounds?.height);
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
      await expect(
        page.locator(".aui-working-trace-header").first(),
      ).toContainText("Stopped");
      await expect(page.getByRole("button", { name: /^Worked/ })).toHaveCount(
        0,
      );
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
      const stoppedTraces = page.locator(".aui-working-trace-header");
      const stoppedTraceCount = await stoppedTraces.count();
      assert.ok(
        stoppedTraceCount >= 2,
        "Earlier stopped traces remain in history",
      );
      for (const trace of await stoppedTraces.all())
        await expect(trace).toContainText("Stopped");
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
      if (viewport.name === "mobile") {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
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
      await expect(stoppedTraces).toHaveCount(stoppedTraceCount);
      for (const trace of await stoppedTraces.all())
        await expect(trace).toContainText("Stopped");
      await expect(page.getByRole("button", { name: /^Worked/ })).toHaveCount(
        0,
      );
      await page.screenshot({
        path: `${output}/${viewport.name}-reloaded.png`,
        fullPage: true,
      });
      const legacyInterruptRequests = interruptCount;
      const startFreshRace = async (state) => {
        suppressedTerminalTurn = undefined;
        const newChat = page.getByRole("button", {
          name: "New chat",
          exact: true,
        });
        if (!(await newChat.isVisible()))
          await page
            .getByRole("button", { name: "Toggle Sidebar", exact: true })
            .first()
            .click();
        await newChat.click();
        if (viewport.name === "mobile") {
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toHaveCount(0);
        }
        await composer.fill(`terminal race fixture ${state}`);
        await page
          .getByRole("button", { name: "Send message", exact: true })
          .click();
        await expect(
          page.getByText(
            `Durable ${state === "failed" ? "failed" : "completed"} answer fixture before Stop acknowledgment.`,
            { exact: true },
          ),
        ).toBeVisible();
        const responseKey = `fixture-race-answer-${turn}`;
        await page
          .getByRole("button", { name: "Stop generating", exact: true })
          .evaluate((button) => {
            button.click();
            button.click();
          });
        await expect(
          page.getByRole("button", {
            name: "Stopping generation",
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          page.getByRole("button", { name: "Send message", exact: true }),
        ).toBeVisible();
        const acknowledgment = raceAcknowledgements.at(-1);
        assert.equal(acknowledgment.terminal_turn.state, state);
        assert.deepEqual(acknowledgment.events, []);
        assert.equal(acknowledgment.stopped_turn_id, undefined);
        return responseKey;
      };
      const completedResponseKey = await startFreshRace("complete");
      await expect(page.locator(".aui-working-answer")).toHaveText(
        "Durable completed answer fixture before Stop acknowledgment.",
      );
      await expect(page.locator(".aui-working-trace-header")).toContainText(
        "Worked",
      );
      await expect(page.getByRole("button", { name: /^Stopped/ })).toHaveCount(
        0,
      );
      const completedRerun = page.getByRole("button", {
        name: "Rerun",
        exact: true,
      });
      await expect(completedRerun).toBeVisible();
      await page.screenshot({
        path: `${output}/${viewport.name}-stop-completed-race.png`,
        fullPage: true,
      });
      suppressedTerminalTurn = undefined;
      await completedRerun.evaluate((button) => button.click());
      await expect(
        page.getByText(
          "Regenerated answer fixture: original actions were not repeated.",
          { exact: true },
        ),
      ).toBeVisible();
      const raceRerun = records
        .filter((entry) => entry.type === "start")
        .at(-1);
      assert.equal(raceRerun.regenerate, completedResponseKey);
      assert.equal(raceRerun.message, "terminal race fixture complete");
      await startFreshRace("failed");
      await expect(
        page.getByText(
          "Durable failed answer fixture before Stop acknowledgment.",
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      await expect(page.locator(".aui-working-trace-header")).toContainText(
        "Failed",
      );
      await expect(
        page.getByRole("button", { name: /^Stopped|^Worked/ }),
      ).toHaveCount(0);
      await expect(page.locator(".aui-working-answer")).toHaveCount(0);
      await expect(
        page.getByText("This run failed before it could finish.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: `${output}/${viewport.name}-stop-failed-race.png`,
        fullPage: true,
      });
      assert.equal(interruptCount - legacyInterruptRequests, 2);
      const newChat = page.getByRole("button", {
        name: "New chat",
        exact: true,
      });
      if (!(await newChat.isVisible()))
        await page
          .getByRole("button", { name: "Toggle Sidebar", exact: true })
          .first()
          .click();
      await newChat.click();
      if (viewport.name === "mobile") {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
      await composer.fill("uncertain-start interruption fixture");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect(
        page.getByText("Unable to confirm message", { exact: true }),
      ).toBeVisible();
      const uncertainStop = page.getByRole("button", {
        name: "Stop generating",
        exact: true,
      });
      await expect(uncertainStop).toBeVisible();
      const uncertainTurn = `fixture-turn-${turn}`;
      const stopErrorsBefore = await page
        .getByText("Unable to stop generation", { exact: true })
        .count();
      failNextInterrupt = true;
      await uncertainStop.evaluate((button) => {
        button.click();
        button.click();
      });
      await expect(
        page.getByText("Unable to stop generation", { exact: true }),
      ).toHaveCount(stopErrorsBefore + 1);
      await expect(
        page.getByText("Unable to stop generation", { exact: true }).first(),
      ).toBeVisible();
      await expect(uncertainStop).toBeEnabled();
      await page.screenshot({
        path: `${output}/${viewport.name}-uncertain-stop-retry.png`,
        fullPage: true,
      });
      await uncertainStop.evaluate((button) => {
        button.click();
        button.click();
      });
      await expect(
        page.getByRole("button", { name: /^Stopped/ }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Stop generating", exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: `${output}/${viewport.name}-uncertain-stopped.png`,
        fullPage: true,
      });
      const uncertainRequests = records.filter(
        (entry) =>
          entry.type === "start" &&
          entry.message === "uncertain-start interruption fixture",
      );
      assert.equal(uncertainRequests.length, 2);
      assert.equal(
        uncertainRequests[0].idempotencyKey,
        uncertainRequests[1].idempotencyKey,
      );
      const uncertainInterrupts = records
        .filter((entry) => entry.type === "interrupt")
        .slice(-2);
      assert.equal(uncertainInterrupts.length, 2);
      assert.ok(
        uncertainInterrupts.every((entry) => entry.turnId === uncertainTurn),
      );
      assert.equal(interruptCount - legacyInterruptRequests, 4);
      const resetConversation = async () => {
        if (!(await newChat.isVisible()))
          await page
            .getByRole("button", { name: "Toggle Sidebar", exact: true })
            .first()
            .click();
        await newChat.click();
        if (viewport.name === "mobile") {
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toHaveCount(0);
        }
      };
      const send = page.getByRole("button", {
        name: "Send message",
        exact: true,
      });
      await resetConversation();
      await composer.fill("unadmitted-start fixture");
      await send.click();
      await expect(uncertainStop).toBeVisible();
      await uncertainStop.evaluate((button) => {
        button.click();
        button.click();
      });
      await expect(send).toBeEnabled();
      await expect(uncertainStop).toHaveCount(0);
      await expect(composer).toHaveText("unadmitted-start fixture");
      await page.screenshot({
        path: `${output}/${viewport.name}-unadmitted-send.png`,
        fullPage: true,
      });
      await send.click();
      await expect(
        page.getByText("Initial answer fixture: ready for edit and rerun.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(send).toBeEnabled();
      const unadmittedRequests = records.filter(
        (entry) =>
          entry.type === "start" &&
          entry.message === "unadmitted-start fixture",
      );
      assert.equal(unadmittedRequests.length, 2);
      assert.equal(
        unadmittedRequests[0].idempotencyKey,
        unadmittedRequests[1].idempotencyKey,
      );
      for (const outcome of ["complete", "failed"]) {
        await resetConversation();
        await composer.fill(`terminal-uncertain fixture ${outcome}`);
        await send.click();
        await expect(uncertainStop).toBeVisible();
        await uncertainStop.evaluate((button) => {
          button.click();
          button.click();
        });
        await expect(send).toBeEnabled();
        await expect(uncertainStop).toHaveCount(0);
        await expect(
          page
            .getByText(
              `Terminal-uncertain ${outcome}: durable answer preserved.`,
              { exact: true },
            )
            .last(),
        ).toBeVisible();
        if (outcome === "complete")
          await expect(
            page.getByRole("button", { name: "Rerun", exact: true }),
          ).toBeEnabled();
        else
          await expect(
            page.getByRole("button", { name: /^Failed/ }),
          ).toBeVisible();
        await page.screenshot({
          path: `${output}/${viewport.name}-terminal-uncertain-${outcome}.png`,
          fullPage: true,
        });
        assert.equal(
          records.filter(
            (entry) =>
              entry.type === "start" &&
              entry.message === `terminal-uncertain fixture ${outcome}`,
          ).length,
          1,
        );
      }
      assert.equal(interruptCount - legacyInterruptRequests, 4);
      assert.deepEqual(unexpected, []);
      report.scenarios.push({
        viewport: viewport.name,
        result: "PASS",
        repeatedRerunStarts: 1,
        totalRegenerationStarts: 2,
        regenerationAfterEdit: "PASS",
        repeatedEditStarts: 1,
        repeatedInterruptRequests: 1,
        totalInterruptRequests: legacyInterruptRequests,
        terminalRaceInterruptRequests: 2,
        uncertainAdmissionInterruptRequests: 2,
        uncertainStartRecoveryAndRepeatedStopRetry:
          "PASS (same intent/key and exact admitted turn)",
        unadmittedStopRestoresSendAndSameKeyRetry: "PASS",
        terminalUncertainStopPreservesAnswerAndRestoresSend:
          "PASS (complete/failed; no start replay or interruption)",
        combinedInterruptRequests: interruptCount,
        stopRacingCompletePreservesFinalAnswerAndRerun: "PASS",
        stopRacingFailedPreservesFailure: "PASS",
        boundedTerminalAcknowledgement:
          "PASS (complete/failed terminal_turn without terminal events or stopped_turn_id)",
        thinkingOnlyStop: "PASS",
        workingToolAndStreamingStop: "PASS",
        failedInterruptRetry: "PASS",
        stopBeforeStartAcknowledgement: "PASS",
        earlierStoppedTraceAfterNewTurnAndReload: "PASS",
        iconOnlyPendingStop:
          "PASS (disabled, unchanged size, no visible text, accessible label retained)",
        streamingFrames: streamFrames,
        feedbackMs: Math.round(feedbackMs),
        latencyMeasurement:
          "Browser MutationObserver timestamps from click to pending control and click to visible Send; synthetic 650ms upstream acknowledgement delay",
        boundedInterruptAcknowledgement:
          "PASS (stopped_turn_id without terminal event)",
        interruptAcknowledgedMs: Math.round(settledMs),
        records,
        raceAcknowledgements,
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
