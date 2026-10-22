import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper, type StepStatus } from "./stepper";

const STEPS = [
  { key: "a", label: "Alpha" },
  { key: "b", label: "Beta" },
  { key: "c", label: "Gamma" },
];

/** Read each step's status from its dot (the only visual carrier of state). */
function renderedStatuses(): StepStatus[] {
  return screen.getAllByRole("listitem").map((item) => {
    const dot = item.querySelector("div > :first-child");
    const className = dot?.getAttribute("class") ?? "";
    if (className.includes("text-green-500")) return "done";
    if (className.includes("text-red-500")) return "failed";
    if (className.includes("border-blue-500")) return "active";
    return "pending";
  });
}

describe("Stepper", () => {
  it.each([
    ["the first step is current", "a", false, ["active", "pending", "pending"]],
    ["a middle step is current", "b", false, ["done", "active", "pending"]],
    ["the last step is current", "c", false, ["done", "done", "done"]],
    ["the current step failed", "b", true, ["done", "failed", "pending"]],
    ["current is not found", "nonexistent", false, ["pending", "pending", "pending"]],
  ] as const)("marks step states when %s", (_case, current, failed, expected) => {
    render(<Stepper steps={STEPS} current={current} failed={failed} />);
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(renderedStatuses()).toEqual(expected);
  });

  it("renders an empty list when there are no steps", () => {
    render(<Stepper steps={[]} current="" />);
    expect(screen.getByRole("list")).toBeEmptyDOMElement();
  });
});
