import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LatencyChart } from "./app-detail-view";

function chart(values: Array<number | null>) {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<LatencyChart values={values} />);
  return root;
}

describe("LatencyChart", () => {
  it("shows an isolated measurement as a visible point without inventing a line", () => {
    const values = Array<number | null>(24).fill(null);
    values[2] = 43.5;
    const root = chart(values);
    expect(
      root
        .querySelector('[title="21h ago: 43.5 s"]')
        ?.classList.contains("size-2"),
    ).toBe(true);
    expect(root.querySelectorAll("polyline")).toHaveLength(0);
    expect(
      root.querySelector('[role="img"]')?.getAttribute("aria-label"),
    ).toContain("1 hourly sample");
  });

  it("keeps gaps and zero-valued measurements distinct", () => {
    const root = chart([0, 2, null, 3, 4]);
    expect(root.querySelectorAll("polyline")).toHaveLength(2);
    expect(root.querySelectorAll("[title]")).toHaveLength(4);
    expect(root.querySelector('[title="4h ago: 0.0 s"]')).not.toBeNull();
    expect(root.querySelector('[title="Now: 4.0 s"]')).not.toBeNull();
  });

  it("explains when no latency samples exist", () => {
    const root = chart([null, Number.NaN]);
    expect(root.textContent).toBe("No latency samples in the last 24 hours.");
    expect(root.querySelectorAll("[title]")).toHaveLength(0);
  });
});
