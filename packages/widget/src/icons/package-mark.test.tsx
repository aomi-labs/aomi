import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PackageMark, PackageTile } from "./package-mark";

const URL = "/api/packages/aomi%2Fdefillama/icon";

describe("PackageMark", () => {
  it("draws icon_url as a mask in currentColor, never as an image", () => {
    const { container } = render(
      <PackageMark iconUrl={URL} className="size-3.5" />,
    );
    const mark = container.querySelector<HTMLElement>("[data-package-icon]")!;
    expect(mark.dataset.packageIcon).toBe(URL);
    expect(mark).toHaveClass("bg-current");
    expect(mark.className).not.toMatch(/\btext-aomi-/);
    expect(mark.className).toContain("size-3.5");
    expect(mark.getAttribute("style")).toContain(`url("${URL}")`);
    expect(container.querySelector("img")).toBeNull();
  });

  it("takes the colour its caller gives it", () => {
    const { container } = render(
      <PackageMark iconUrl={URL} className="text-aomi-fg/80" />,
    );
    const mark = container.querySelector<HTMLElement>("[data-package-icon]")!;
    expect(mark).toHaveClass("bg-current", "text-aomi-fg/80");
    const glyph = render(
      <PackageMark iconUrl={null} className="text-aomi-fg/80" />,
    ).container.querySelector("svg.lucide-package")!;
    expect(glyph).toHaveClass("text-aomi-fg/80");
  });

  it("shows the generic package icon without an icon_url", () => {
    const { container } = render(<PackageMark iconUrl={null} />);
    expect(container.querySelector("svg.lucide-package")).not.toBeNull();
    expect(container.querySelector("[data-package-icon]")).toBeNull();
  });

  it("sits on a plain tile with its icon, the accent tile without", () => {
    const row = render(<PackageTile iconUrl={URL} />).container;
    expect(row.firstElementChild).toHaveClass(
      "size-8",
      "bg-aomi-raised",
      "border",
      "text-aomi-accent-strong",
    );
    expect(row.querySelector("[data-package-icon]")).toHaveClass("size-4");
    const plain = render(<PackageTile iconUrl={null} />).container;
    expect(plain.firstElementChild).toHaveClass("bg-aomi-accent-subtle");
    expect(plain.firstElementChild).not.toHaveClass("border");
    expect(plain.querySelector("svg.lucide-package")).not.toBeNull();
    const detail = render(
      <PackageTile iconUrl={URL} size="detail" />,
    ).container;
    expect(detail.firstElementChild).toHaveClass("size-12");
    expect(detail.querySelector("[data-package-icon]")).toHaveClass("size-6");
  });
});
