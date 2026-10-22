import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "./stepper";

const STEPS = [
  { key: "a", label: "Alpha" },
  { key: "b", label: "Beta" },
  { key: "c", label: "Gamma" },
];

describe("Stepper", () => {
  it.each([
    ["the first step is current", "a", false],
    ["a middle step is current", "b", false],
    ["the last step is current", "c", false],
    ["the current step failed", "b", true],
    ["current is not found", "nonexistent", false],
  ] as const)("renders all step labels when %s", (_case, current, failed) => {
    render(<Stepper steps={STEPS} current={current} failed={failed} />);
    for (const step of STEPS) {
      expect(screen.getByText(step.label)).toBeInTheDocument();
    }
  });

  it("renders empty ol when no steps", () => {
    render(<Stepper steps={[]} current="" />);
    expect(screen.queryByRole("list")).toBeInTheDocument();
  });
});
