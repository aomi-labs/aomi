import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PackageMark, PackageTile } from "./package-mark";

const URL = "/api/packages/aomi%2Fdefillama/icon";

describe("PackageMark", () => {
  it("draws icon_url as a mask in the accent colour, never as an image", () => {
    const { container } = render(
      <PackageMark iconUrl={URL} className="size-3.5" />,
    );
    const mark = container.querySelector<HTMLElement>("[data-package-icon]")!;
    expect(mark.dataset.packageIcon).toBe(URL);
    expect(mark.className).toContain("bg-aomi-accent");
    expect(mark.className).toContain("size-3.5");
    expect(mark.getAttribute("style")).toContain(`url("${URL}")`);
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the generic package icon without an icon_url", () => {
    const { container } = render(<PackageMark iconUrl={null} />);
    expect(container.querySelector("svg.lucide-package")).not.toBeNull();
    expect(container.querySelector("[data-package-icon]")).toBeNull();
  });

  it("sits in the Library's soft tile at the row and detail sizes", () => {
    const row = render(<PackageTile iconUrl={URL} />).container;
    expect(row.firstElementChild?.className).toContain("size-9");
    expect(row.querySelector("[data-package-icon]")?.className).toContain(
      "size-5",
    );
    const detail = render(<PackageTile iconUrl={URL} size="detail" />)
      .container;
    expect(detail.firstElementChild?.className).toContain("size-12");
    expect(detail.querySelector("[data-package-icon]")?.className).toContain(
      "size-7",
    );
  });
});
