import { expect, it } from "vitest";
import postcss from "postcss";
import { scopePackageCss } from "./scope-package-css.mjs";
it("contains reset, theme, utilities and animations without global selectors", () => {
  const css = postcss.parse(
    `@layer base { html,body {color:red} :root {--x:1} * {box-sizing:border-box} } @layer utilities {.animate {animation: spin 1s; --tw-ring: blue}} @keyframes spin {to {transform:rotate(360deg)}}`,
  );
  scopePackageCss(css);
  const result = css.toString();
  expect(result).not.toContain("@layer");
  expect(result).toContain(".aomi-widget *");
  expect(result).toContain(".aomi-widget .animate");
  expect(result).toContain("animation: aomi-widget-spin 1s");
  expect(result).toContain("@keyframes aomi-widget-spin");
  expect(result).toContain("--aomi-tw-ring");
});

it("blocks host text inheritance while leaving widget element and utility rules in control", () => {
  const css = postcss.parse(
    `p {font-size:14px} .text-base {font-size:16px} strong {font-weight:bolder} em {font-style:italic}`,
  );
  scopePackageCss(css);
  expect(css.nodes[0].selector).toBe(".aomi-widget");
  expect(css.nodes[0].nodes[0].value).toBe("1rem");
  expect(css.nodes[1].selector).toBe(
    ".aomi-widget :where(*), .aomi-widget [contenteditable]",
  );
  expect(css.nodes[1].nodes.map(({ prop }) => prop)).toEqual([
    "font-family",
    "font-size",
    "line-height",
    "color",
  ]);
  expect(css.nodes[1].nodes.every(({ value }) => value === "inherit")).toBe(
    true,
  );
  expect(css.nodes[2].selector).toBe(".aomi-widget p");
  expect(css.toString()).toContain("font-weight:bolder");
  expect(css.toString()).toContain("font-style:italic");
});

it("keeps status variables on each widget root and scopes their animation", () => {
  const css = postcss.parse(
    `.aomi-widget {--animate-aui-thread-status:none} .aomi-widget:has(> [data-current-thread-status="run"]) {--animate-aui-thread-status:status-pulse 2s infinite} .aui-thread-status {animation:var(--animate-aui-thread-status)} @keyframes status-pulse {50% {opacity:.5}}`,
  );
  scopePackageCss(css);
  const result = css.toString();
  expect(result).not.toContain(".aomi-widget .aomi-widget");
  expect(result).toContain(
    '.aomi-widget:has(> [data-current-thread-status="run"])',
  );
  expect(result).toContain(
    "--animate-aui-thread-status:aomi-widget-status-pulse 2s infinite",
  );
  expect(result).toContain(".aomi-widget .aui-thread-status");
});
