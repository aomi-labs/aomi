import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  const { account, setAccount } = useGitHubSession();
  const [draft, setDraft] = useState("");
  return (
    <>
      <p>
        {account.loading ? "Loading" : account.expired ? "Expired" : "Ready"}
      </p>
      <button
        onClick={() =>
          setAccount({
            loading: false,
            signedIn: true,
            githubLogin: "second",
            githubAvatarUrl: null,
            installationId: null,
          })
        }
      >
        Switch account
      </button>
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
  it("clears retained queries when a remounted layout verifies a different account", async () => {
    const client = new QueryClient();
    const first = render(
      <QueryClientProvider client={client}>
        <GitHubSessionProvider>
          <Work />
        </GitHubSessionProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("Ready");
    client.setQueryData(
      ["aomi-build", "account", "builder", "projects"],
      ["private project"],
    );
    first.unmount();
    expect(
      client.getQueryData(["aomi-build", "account", "builder", "projects"]),
    ).toEqual(["private project"]);
    session.mockResolvedValue({ signedIn: true, githubLogin: "second" });
    render(
      <QueryClientProvider client={client}>
        <GitHubSessionProvider>
          <Work />
        </GitHubSessionProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("Ready");
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("retains unsent work during expiry and rechecks authentication on return", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GitHubSessionProvider>
          <Work />
        </GitHubSessionProvider>
      </QueryClientProvider>,
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
  it("cancels every old-account key family and cannot resurrect a delayed result", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rendered = render(
      <QueryClientProvider client={client}>
        <GitHubSessionProvider>
          <Work />
        </GitHubSessionProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("Ready");
    client.setQueryData(
      ["aomi-build", "account", "builder", "projects"],
      ["private project"],
    );
    client.setQueryData(
      ["deployment-attempts", "builder", 42],
      ["private attempt"],
    );
    let finish!: (value: string) => void;
    const pending = client
      .fetchQuery({
        queryKey: ["runtime", "builder", 42],
        queryFn: () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      })
      .catch(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    client.setQueryData(
      ["aomi-build", "account", "second", "projects"],
      ["second project"],
    );
    finish("late private runtime");
    await pending;
    expect(client.getQueryData(["runtime", "builder", 42])).toBeUndefined();
    expect(
      client.getQueryData(["aomi-build", "account", "second", "projects"]),
    ).toEqual(["second project"]);
    rendered.unmount();
    expect(
      client.getQueryData(["aomi-build", "account", "second", "projects"]),
    ).toEqual(["second project"]);
  });
});
