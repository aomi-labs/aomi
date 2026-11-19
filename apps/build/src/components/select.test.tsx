import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";

import { Select } from "./select";

function StatusFilter() {
  const [value, setValue] = useState("");
  return (
    <>
      <Select
        label="Status"
        value={value}
        onChange={setValue}
        options={[
          { value: "", label: "All", count: 3 },
          { value: "current", label: "Current", count: 1 },
        ]}
      />
      <output>{value || "none"}</output>
    </>
  );
}

it("names the filter and its value, and picks a value from the menu", async () => {
  render(<StatusFilter />);
  const trigger = screen.getByRole("button", { name: /^Status/ });
  expect(trigger).toHaveTextContent("StatusAll");

  fireEvent.click(trigger);
  const all = await screen.findByRole("menuitemradio", { name: /All/ });
  expect(all).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("menuitemradio", { name: /Current/ }));

  expect(screen.getByRole("status")).toHaveTextContent("current");
  expect(trigger).toHaveTextContent("StatusCurrent");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
