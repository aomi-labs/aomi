import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { SettingsInitializer } from "./settings-initializer";
const settings = vi.hoisted(() => ({ useSettings: vi.fn() }));
vi.mock("@aomi-labs/widget/host-composition", () => settings);

describe("settings initializer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    settings.useSettings.mockClear();
  });

  it("initializes preferences without starting a second account reader", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(
      <SettingsInitializer>
        <span>Chat</span>
      </SettingsInitializer>,
    );
    expect(settings.useSettings).toHaveBeenCalled();
    expect(screen.getByText("Chat")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
