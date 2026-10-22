import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useSession = vi.hoisted(() => vi.fn());
vi.mock("@aomi-labs/widget/browser-auth", () => ({
  authClient: { useSession },
}));

import { McpAuthorizeResume } from "./mcp-authorize-resume";

describe("MCP authorization resume", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    useSession.mockReset().mockReturnValue({ data: null });
  });
  afterEach(cleanup);

  it("does not start a second auth subscription on an ordinary chat load", () => {
    render(<McpAuthorizeResume />);
    expect(useSession).not.toHaveBeenCalled();
  });

  it("stashes the authorize query and subscribes while login is pending", async () => {
    const query = "?response_type=code&client_id=mcp-client&state=original";
    window.history.replaceState(null, "", `/${query}`);
    render(<McpAuthorizeResume />);
    await waitFor(() => expect(useSession).toHaveBeenCalled());
    expect(sessionStorage.getItem("aomi.mcp.authorize.query")).toBe(query);
  });

  it("resumes observing a stashed request after login rewrites the URL", async () => {
    sessionStorage.setItem(
      "aomi.mcp.authorize.query",
      "?response_type=code&client_id=mcp-client",
    );
    render(<McpAuthorizeResume />);
    await waitFor(() => expect(useSession).toHaveBeenCalled());
  });
});
