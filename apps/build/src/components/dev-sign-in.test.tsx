import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitHubAccountState } from "@/components/control-plane/github-session-context";

import { DevSignIn } from "./dev-sign-in";

let account: GitHubAccountState;

vi.mock("@/components/control-plane/github-session-context", () => ({
  useGitHubSession: () => ({ account }),
}));

const signedOut: GitHubAccountState = {
  loading: false,
  signedIn: false,
  githubLogin: null,
};

describe("DevSignIn", () => {
  beforeEach(() => {
    account = signedOut;
  });

  it("links to the Edge dev sign-in when the Edge offers it", () => {
    account = { ...signedOut, devSignIn: true };
    render(<DevSignIn />);
    expect(
      screen.getByRole("link", { name: "Sign in as test builder (local)" }),
    ).toHaveAttribute("href", "/api/build/auth/github/dev-sign-in");
  });

  it("renders nothing when dev sign-in is off or the builder is signed in", () => {
    const { container, rerender } = render(<DevSignIn />);
    expect(container).toBeEmptyDOMElement();
    account = { ...signedOut, devSignIn: true, signedIn: true };
    rerender(<DevSignIn />);
    expect(container).toBeEmptyDOMElement();
  });
});
