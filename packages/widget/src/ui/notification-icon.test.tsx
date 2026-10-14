import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NotificationIcon } from "./notification-icon";

describe("NotificationIcon", () => {
  afterEach(cleanup);

  it("renders distinct custom artwork for every notification type", () => {
    const types = ["notice", "success", "error", "wallet"] as const;
    const artwork = types.map((type) => {
      const { container, unmount } = render(<NotificationIcon type={type} />);
      const icon = container.querySelector(
        `[data-notification-icon="${type}"]`,
      );
      expect(icon).not.toBeNull();
      expect(icon).toHaveClass("text-aomi-accent");
      expect(icon?.className).not.toContain("bg-");
      const svg = icon?.querySelector("svg");
      expect(svg).not.toBeNull();
      const markup = svg?.innerHTML;
      unmount();
      return markup;
    });

    expect(new Set(artwork).size).toBe(types.length);
  });
});
