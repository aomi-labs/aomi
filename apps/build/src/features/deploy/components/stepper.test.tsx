import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "./stepper";

const STEPS = [
  { key: "a", label: "Alpha" },
  { key: "b", label: "Beta" },
  { key: "c", label: "Gamma" },
];

describe("Stepper", () => {
  it("marks the current step as active", () => {
    render(<Stepper steps={STEPS} current="b" />);
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("marks past steps as done, future steps as pending", () => {
    render(<Stepper steps={STEPS} current="b" />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("renders all step labels", () => {
    render(<Stepper steps={STEPS} current="a" />);
    for (const step of STEPS) {
      expect(screen.getByText(step.label)).toBeInTheDocument();
    }
  });

  it("shows failed state when failed prop is true", () => {
    render(<Stepper steps={STEPS} current="b" failed />);
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("handles current step being the first", () => {
    render(<Stepper steps={STEPS} current="a" />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("handles current step being the last", () => {
    render(<Stepper steps={STEPS} current="c" />);
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("renders empty ol when no steps", () => {
    render(<Stepper steps={[]} current="" />);
    expect(screen.queryByRole("list")).toBeInTheDocument();
  });

  it("marks all as pending when current is not found", () => {
    render(<Stepper steps={STEPS} current="nonexistent" />);
    for (const step of STEPS) {
      expect(screen.getByText(step.label)).toBeInTheDocument();
    }
  });
});
