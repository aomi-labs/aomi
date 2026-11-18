import { describe, expect, it } from "vitest";

import { checkIcon } from "./icon-rule";

// The same cases and messages as the release check (`aomi-registry` icon.rs).
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;
const bytes = (text: string) => new TextEncoder().encode(text);
const refusal = (text: string) => checkIcon("icon.svg", bytes(text));

describe("checkIcon", () => {
  it("passes a monochrome square SVG", () => {
    const icon = `<?xml version="1.0" encoding="UTF-8"?>
<!-- a mark -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0,0,16,16" fill="none" stroke="currentColor" opacity="0.9">
  <title>Mark</title>
  <defs><clipPath id="c"><rect width="16" height="16"/></clipPath><path id="p" d="M1 1h4"/></defs>
  <g clip-path="url(#c)" style="fill: currentColor; fill-opacity: .5">
    <path d="M2 2h12v12H2z" fill="CurrentColor"/>
    <use xlink:href="#p"/>
  </g>
</svg>`;
    expect(checkIcon("Icon.SVG", bytes(icon))).toBeNull();
    expect(refusal(svg('<path d="M0 0h1"/>'))).toBeNull();
  });

  it("wants a small UTF-8 SVG with an <svg> root", () => {
    expect(checkIcon("icon.png", bytes(svg("")))).toBe("the icon must be an .svg file");
    const big = svg(`<!--${"x".repeat(32 * 1024)}-->`);
    expect(refusal(big)).toBe(`the icon is ${big.length} bytes; the limit is 32 KB`);
    expect(checkIcon("icon.svg", new Uint8Array([0x3c, 0xff]))).toBe("the icon is not UTF-8 text");
    expect(refusal("<svg viewBox='0 0 1 1'>")).toBe("the icon is not well-formed XML");
    expect(refusal("<html viewBox='0 0 1 1'/>")).toBe("the root element must be <svg>");
  });

  it.each([
    "<svg/>",
    "<svg viewBox='0 0 24 12'/>",
    "<svg viewBox='0 0 0 0'/>",
    "<svg viewBox='0 0 24'/>",
    "<svg viewBox='0 0 a a'/>",
  ])("wants a square viewBox: %s", (root) => {
    expect(refusal(root)).toBe("the <svg> needs a square viewBox");
  });

  it("refuses declarations and processing instructions", () => {
    expect(refusal('<!DOCTYPE svg><svg viewBox="0 0 1 1"/>')).toBe(
      "DOCTYPE and ENTITY declarations are not allowed",
    );
    expect(refusal('<!doctype svg [<!ENTITY a "b">]><svg viewBox="0 0 1 1"/>')).toBe(
      "DOCTYPE and ENTITY declarations are not allowed",
    );
    expect(
      refusal('<?xml-stylesheet href="https://x.test/a.css"?><svg viewBox="0 0 1 1"/>'),
    ).toBe("the processing instruction <?xml-stylesheet?> is not allowed");
  });

  it.each([
    ["<script>alert(1)</script>", "<script> is not allowed"],
    ["<SCRIPT/>", "<script> is not allowed"],
    ['<h:script xmlns:h="http://www.w3.org/2000/svg"/>', "<script> is not allowed"],
    ["<foreignObject/>", "<foreignObject> is not allowed"],
    ['<image href="#a"/>', "<image> is not allowed"],
    ["<style>path{fill:red}</style>", "<style> is not allowed"],
    ['<path onload="x()"/>', "the event attribute onload is not allowed"],
    ['<path ONCLICK="x()"/>', "the event attribute ONCLICK is not allowed"],
    ['<use href="https://x.test/a.svg#p"/>', "an href outside the file is not allowed"],
    [
      '<a xmlns:x="http://www.w3.org/1999/xlink" x:href="javascript:x()"/>',
      "an href outside the file is not allowed",
    ],
    ['<g mask="url(https://x.test/m.svg)"/>', "a url() outside the file is not allowed"],
    [`<g style="mask: URL( 'data:image/png,x')"/>`, "a url() outside the file is not allowed"],
    ['<g style="mask: \\75rl(https://x.test)"/>', "a CSS escape is not allowed"],
    ['<path fill="red"/>', "the colour fill: red is not allowed; use currentColor or none"],
    ['<path stroke="#000"/>', "the colour stroke: #000 is not allowed; use currentColor or none"],
    ['<g color="blue"/>', "the colour color: blue is not allowed; use currentColor or none"],
    [
      '<stop stop-color="white"/>',
      "the colour stop-color: white is not allowed; use currentColor or none",
    ],
    [
      '<path style="opacity:.5;Fill: rgb(0,0,0)"/>',
      "the colour Fill: rgb(0,0,0) is not allowed; use currentColor or none",
    ],
    ['<path fill="url(#g)"/>', "the colour fill: url(#g) is not allowed; use currentColor or none"],
    ['<path fill="&#114;ed"/>', "the colour fill: red is not allowed; use currentColor or none"],
  ])("refuses %s", (body, message) => {
    expect(refusal(svg(body))).toBe(message);
  });
});
