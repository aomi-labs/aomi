import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { register } from "tsx/esm/api";

register();
const { createFakeAgentServer } =
  await import("../../../tests/e2e/fake-backend/server.ts");

/** The shared fake agent, plus the guest token and catalogs a Portal would serve. */
export async function startUpstream() {
  const server = await createFakeAgentServer({
    routes: {
      "/api/auth/widget/guest": {
        access_token: "fixture-guest",
        expires_at: Date.now() / 1000 + 3600,
      },
      "/api/public/catalog/models": ["gpt-5", "claude-sonnet-4-5"],
      "/api/public/catalog/apps": [],
      "/api/public/catalog/skills": [],
      "/api/thread/models": ["gpt-5", "claude-sonnet-4-5"],
      "/api/thread/apps": [],
      "/api/resource/skills": [],
    },
  });
  return {
    origin: server.origin,
    starts: () => server.backend.starts().length,
    close: () => server.close(),
  };
}
export const hostMarkup =
  '<h1>Host heading</h1><p id="host-content">Host paragraph</p><ul><li>Host list item</li></ul><a href="#host-content">Host link</a> <button>Host button</button>';
export async function verifyConsumer({ origin, upstream, css, provider }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(30_000);
    const errors = [];
    const errorDiagnostics = [];
    let stage = "mount";
    const providerRequests = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      errorDiagnostics.push({
        stage,
        elapsedMs: Math.round(performance.now() - startedAt),
        message: error.message,
        stack: error.stack?.slice(0, 2000),
        frameOrigins: page.frames().map((frame) => {
          try {
            return new URL(frame.url()).origin;
          } catch {
            return "about:blank";
          }
        }),
      });
    });
    const startedAt = performance.now();
    page.on("request", (request) => {
      if (/privy|para-plugin/.test(request.url()))
        providerRequests.push(request.url());
    });
    await page.goto(origin);
    const widgets = page.locator(".aomi-widget");
    await widgets.first().waitFor();
    assert.equal(await widgets.count(), 2, "Both widget instances mount");
    stage = "send";
    for (let index = 0; index < 2; index++) {
      const widget = widgets.nth(index);
      await widget
        .getByRole("textbox", { name: "Message input" })
        .fill(`Fresh message ${index}`);
      await widget.getByRole("button", { name: "Send message" }).click();
      await widget
        .getByText(`Fake reply: Fresh message ${index}`, { exact: true })
        .waitFor();
    }
    assert.equal(upstream.starts(), 2, "One start per submitted message");
    assert.deepEqual(
      errors,
      [],
      "Fresh consumers have no uncaught browser errors",
    );
    stage = "reverse-host-styles";
    const button = widgets
      .first()
      .getByRole("button", { name: "Send message" });
    const metrics = (element) => {
      const style = getComputedStyle(element);
      return {
        font: style.font,
        color: style.color,
        background: style.backgroundColor,
        border: style.borderWidth,
        padding: style.padding,
      };
    };
    const probes = [
      button,
      widgets.first().getByRole("textbox", { name: "Message input" }),
      widgets.first().getByText("Fake reply: Fresh message 0", { exact: true }),
    ];
    const before = await Promise.all(
      probes.map((probe) => probe.evaluate(metrics)),
    );
    await page.addStyleTag({
      content:
        "body,h1,p,ul,a { color: magenta; font: 40px Georgia; } button { color: magenta; font: 40px Georgia; border: 17px solid red; padding: 30px; background: yellow; } textarea,[contenteditable] { font: 40px Georgia; }",
    });
    assert.deepEqual(
      await Promise.all(probes.map((probe) => probe.evaluate(metrics))),
      before,
      "Host element styles leave widget controls and messages unchanged",
    );
    const themes = await widgets.evaluateAll((roots) =>
      roots.map((element) =>
        getComputedStyle(element).getPropertyValue("--aomi-bg"),
      ),
    );
    assert.notEqual(
      themes[0],
      themes[1],
      "Dark and light instances own distinct theme tokens",
    );
    stage = "overlays-and-selected-sdk";
    // Open both using the fixture's DOM buttons without pointer-outside dismissal.
    for (let index = 0; index < 2; index++) {
      await widgets
        .nth(index)
        .getByRole("combobox")
        .filter({ hasText: "Auto" })
        .evaluate((element) => element.click());
    }
    const overlays = page.locator("[data-aomi-overlays]");
    for (let index = 0; index < 2; index++) {
      await overlays
        .nth(index)
        .locator("[data-radix-popper-content-wrapper]")
        .waitFor();
      assert.equal(
        await overlays
          .nth(index)
          .evaluate((element) =>
            getComputedStyle(element).getPropertyValue("--aomi-bg"),
          ),
        themes[index],
        "Overlay inherits only its owning instance theme",
      );
    }
    assert.equal(
      await page.locator("body > [data-radix-popper-content-wrapper]").count(),
      0,
      "No widget overlay escapes to body",
    );
    if (!provider)
      assert.equal(
        providerRequests.length,
        0,
        "Guest loads no embedded SDK chunk",
      );
    if (provider) {
      assert.ok(
        providerRequests.some((url) => url.includes(`${provider}-plugin`)),
        "Chosen embedded wallet loads its own provider island",
      );
      const other = provider === "privy" ? "para" : "privy";
      assert.equal(
        providerRequests.some((url) => url.includes(`${other}-plugin`)),
        false,
        "Chosen embedded wallet does not load the other provider island",
      );
    }
    stage = "host-stylesheet-isolation";
    // Replacing the live React document detaches SDK iframes without an
    // unmount. Test stylesheet-only host pixels on an independent page.
    const hostPage = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    hostPage.setDefaultTimeout(30_000);
    hostPage.setDefaultNavigationTimeout(30_000);
    await hostPage.setContent(
      `<style>body{font:18px Georgia;color:purple}button{border:7px solid orange;padding:11px;background:yellow}h1{font-size:31px;margin:12px}p{margin:9px;color:navy}ul{padding-left:29px;list-style:square}a{color:green;text-decoration:underline}</style><div id="host">${hostMarkup}</div>`,
    );
    const host = hostPage.locator("#host");
    const computed = () =>
      hostPage.locator("body,h1,p,ul,a,button").evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element);
          return {
            tag: element.tagName,
            font: style.font,
            color: style.color,
            background: style.backgroundColor,
            margin: style.margin,
            padding: style.padding,
            border: style.border,
            list: style.listStyle,
            decoration: style.textDecoration,
          };
        }),
      );
    const computedBefore = await computed();
    const hostBefore = await host.screenshot();
    await hostPage.addStyleTag({ content: readFileSync(css, "utf8") });
    assert.deepEqual(
      await computed(),
      computedBefore,
      "Widget CSS preserves body, heading, paragraph, list, link and button styles",
    );
    assert.ok(
      hostBefore.equals(await host.screenshot()),
      "Widget stylesheet changes zero host pixels",
    );
    await hostPage.close();
    assert.deepEqual(
      errors,
      [],
      `Fresh consumers have no uncaught browser errors through final provider/overlay and host verification: ${JSON.stringify(errorDiagnostics)}`,
    );
    return {
      provider,
      starts: upstream.starts(),
      pageErrors: errors,
      hostPixels: "identical",
      providerRequests: providerRequests.length,
    };
  } finally {
    await browser.close();
  }
}
