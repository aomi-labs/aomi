import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("live status styles stay inside their widget without sidebar writes", async ({
  page,
}) => {
  const css = await readFile(
    new URL("../../../packages/widget/dist/styles.css", import.meta.url),
    "utf8",
  );
  const row = (active: boolean) =>
    `<div class="aui-thread-list-item group/thread" ${active ? "data-active" : ""}><span class="aui-thread-status size-1.5 shrink-0 rounded-full group-data-active/thread:opacity-100 opacity-0"></span></div>`;
  const widget = (id: string, nested = "") =>
    `<div class="aomi-widget" id="${id}" style="--aomi-accent-strong:rgb(0,100,200);--aomi-warning:rgb(200,120,0)"><span role="status" data-current-thread-status="idle"></span><div data-testid="aomi-sidebar">${row(true)}${row(false)}</div><div data-aomi-overlays><div data-testid="aomi-mobile-sheet">${row(true)}</div></div>${nested}</div>`;
  await page.setContent(
    `<style>${css}</style>${widget("first", widget("nested"))}${widget("second")}`,
  );
  const active = page.locator(
    '#first > [data-testid="aomi-sidebar"] [data-active] .aui-thread-status',
  );
  const inactive = page.locator(
    '#first > [data-testid="aomi-sidebar"] .aui-thread-list-item:not([data-active]) .aui-thread-status',
  );
  const other = page
    .locator("#second [data-active] .aui-thread-status")
    .first();
  const mobile = page.locator(
    '#first > [data-aomi-overlays] [data-testid="aomi-mobile-sheet"] .aui-thread-status',
  );
  await page.evaluate(() => {
    const counters = { writes: 0 };
    const observer = new MutationObserver((records) => {
      counters.writes += records.length;
    });
    for (const sidebar of document.querySelectorAll(
      '[data-testid="aomi-sidebar"], [data-testid="aomi-mobile-sheet"]',
    ))
      observer.observe(sidebar, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
    Object.assign(window, { sidebarWriteCounters: counters });
  });
  const state = async (value: string) =>
    page
      .locator("#first > [data-current-thread-status]")
      .evaluate(
        (node, value) => node.setAttribute("data-current-thread-status", value),
        value,
      );
  await state("run");
  await expect(active).toHaveCSS(
    "animation-name",
    "aomi-widget-auiThreadStatusPulse",
  );
  await expect(mobile).toHaveCSS(
    "animation-name",
    "aomi-widget-auiThreadStatusPulse",
  );
  await expect(inactive).toHaveCSS("animation-name", "none");
  await expect(inactive).toHaveCSS("opacity", "0");
  await expect(other).toHaveCSS("animation-name", "none");
  await expect(
    page.locator("#nested [data-active] .aui-thread-status").first(),
  ).toHaveCSS("animation-name", "none");
  await state("sign");
  await expect(active).toHaveCSS("background-color", "rgb(200, 120, 0)");
  await expect(mobile).toHaveCSS("background-color", "rgb(200, 120, 0)");
  await expect(other).toHaveCSS("background-color", "rgb(0, 100, 200)");
  await expect(active).toHaveCSS("animation-name", "none");
  await state("run");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(active).toHaveCSS("animation-name", "none");
  await state("idle");
  await expect(active).toHaveCSS("background-color", "rgb(0, 100, 200)");
  expect(await page.evaluate("window.sidebarWriteCounters.writes")).toBe(0);
});
