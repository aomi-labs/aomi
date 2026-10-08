import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Segmented, type SegmentedOption } from "./segmented";

type Theme = "dark" | "light" | "auto";

const OPTIONS: SegmentedOption<Theme>[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "auto", label: "System" },
];

function Harness({
  options = OPTIONS,
  onChange,
}: {
  options?: SegmentedOption<Theme>[];
  onChange?: (value: Theme) => void;
}) {
  const [value, setValue] = useState<Theme>("dark");
  return (
    <Segmented
      label="Theme"
      value={value}
      options={options}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("Segmented", () => {
  it("is a radio group with a single tab stop on the selected option", () => {
    render(<Harness />);

    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
    const dark = screen.getByRole("radio", { name: "Dark" });
    expect(dark).toHaveAttribute("aria-checked", "true");
    expect(dark).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("selects on click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(onChange).toHaveBeenCalledWith("auto");
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("moves selection and focus with arrows, wrapping, Home and End", () => {
    render(<Harness />);
    const dark = screen.getByRole("radio", { name: "Dark" });
    const light = screen.getByRole("radio", { name: "Light" });
    const system = screen.getByRole("radio", { name: "System" });

    fireEvent.keyDown(dark, { key: "ArrowRight" });
    expect(light).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(light);

    fireEvent.keyDown(light, { key: "End" });
    expect(system).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(system, { key: "ArrowDown" });
    expect(dark).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(dark);

    fireEvent.keyDown(dark, { key: "ArrowLeft" });
    expect(system).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(system, { key: "Home" });
    expect(dark).toHaveAttribute("aria-checked", "true");
  });

  it("skips disabled options", () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        options={[OPTIONS[0], { ...OPTIONS[1], disabled: true }, OPTIONS[2]]}
      />,
    );

    fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenCalledWith("auto");
    expect(screen.getByRole("radio", { name: "Light" })).toBeDisabled();
  });
});
