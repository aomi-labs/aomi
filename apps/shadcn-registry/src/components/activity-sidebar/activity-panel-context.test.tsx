import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  ActivityPanelProvider,
  useActivityPanel,
} from "./activity-panel-context";

function ActivityStateHarness() {
  const activity = useActivityPanel();

  return (
    <>
      <output data-testid="activity-state">
        {String(activity.worthShowing)}:{String(activity.open)}
      </output>
      <button
        type="button"
        onClick={() => activity.setWorthShowing(true, false)}
      >
        Activity arrives
      </button>
      <button type="button" onClick={() => activity.setOpen(false)}>
        Hide
      </button>
      <button
        type="button"
        onClick={() => activity.setWorthShowing(true, true)}
      >
        Activity updates
      </button>
      <button
        type="button"
        onClick={() => activity.setWorthShowing(false, false)}
      >
        Activity clears
      </button>
    </>
  );
}

afterEach(cleanup);

describe("ActivityPanelProvider", () => {
  it("opens on first activity, then preserves explicit visibility choices", () => {
    render(
      <ActivityPanelProvider>
        <ActivityStateHarness />
      </ActivityPanelProvider>,
    );

    expect(screen.getByTestId("activity-state")).toHaveTextContent(
      "false:false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Activity arrives" }));
    expect(screen.getByTestId("activity-state")).toHaveTextContent("true:true");

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    fireEvent.click(screen.getByRole("button", { name: "Activity updates" }));
    expect(screen.getByTestId("activity-state")).toHaveTextContent(
      "true:false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Activity clears" }));
    expect(screen.getByTestId("activity-state")).toHaveTextContent(
      "false:false",
    );
  });
});
