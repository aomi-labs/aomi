import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AgentIdentityIcon } from "./agent-identity-icon";

/** Images that load or fail when the test says so. */
const images: { src: string; onload: (() => void) | null }[] = [];

afterEach(() => {
  images.length = 0;
  vi.unstubAllGlobals();
});

function stubImages() {
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      onload: (() => void) | null = null;
      constructor() {
        images.push(this);
      }
    },
  );
}

it("shows the initials, never a broken image, until the icon loads", () => {
  stubImages();
  const { container } = render(
    <AgentIdentityIcon
      brandId=""
      name="Trade Desk"
      imageUrl="/api/packages/arixoneth%2Ftrade/icon"
    />,
  );
  expect(screen.getByText("TD")).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();

  act(() => images[0]!.onload?.());
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/packages/arixoneth%2Ftrade/icon",
  );
  expect(screen.queryByText("TD")).not.toBeInTheDocument();
});

it("keeps the initials when the icon is not served", () => {
  stubImages();
  const { container } = render(
    <AgentIdentityIcon brandId="" name="Trade" imageUrl="/missing" />,
  );
  expect(images[0]!.src).toBe("/missing");
  expect(screen.getByText("TR")).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
});
