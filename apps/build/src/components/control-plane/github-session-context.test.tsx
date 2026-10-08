import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  GitHubSessionProvider,
  useGitHubSession,
} from "./github-session-context";
import { BUILD_SESSION_EXPIRED } from "@/lib/session-expiry";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/features/deploy/dashboard", () => ({
  fetchGitHubSession: session,
}));
function Work() {
  const { account } = useGitHubSession();
  const [draft, setDraft] = useState("");
  return (
    <>
      <p>
        {account.loading ? "Loading" : account.expired ? "Expired" : "Ready"}
      </p>
      <input
        aria-label="Draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </>
  );
}
beforeEach(() => {
  session
    .mockReset()
    .mockResolvedValue({ signedIn: true, githubLogin: "builder" });
});
describe("browser session recovery", () => {
  it("retains unsent work during expiry and rechecks authentication on return", async () => {
    render(
      <GitHubSessionProvider>
        <Work />
      </GitHubSessionProvider>,
    );
    await screen.findByText("Ready");
    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "Unsent app description" },
    });
    fireEvent(window, new Event(BUILD_SESSION_EXPIRED));
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByLabelText("Draft")).toHaveValue(
      "Unsent app description",
    );
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
    expect(screen.getByLabelText("Draft")).toHaveValue(
      "Unsent app description",
    );
    expect(session).toHaveBeenCalledTimes(2);
  });
});
