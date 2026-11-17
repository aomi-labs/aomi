import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThreadModeControl } from "./thread-mode-control";

describe("ThreadModeControl", () => {
  it("uses the shared Help badge for its explanation", () => {
    const onChange = vi.fn();
    render(<ThreadModeControl value="single" onChange={onChange} />);

    const help = screen.getByRole("button", { name: "About thread mode" });
    expect(help).toHaveTextContent("?");
    expect(help).toHaveClass("h-[18px]", "w-[18px]", "text-[11px]");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Single thread keeps the bot to one conversation",
    );

    fireEvent.click(screen.getByRole("radio", { name: "Multiple threads" }));
    expect(onChange).toHaveBeenCalledWith("multi");
  });
});
